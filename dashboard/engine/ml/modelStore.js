// dashboard/engine/ml/modelStore.js
// Save and load TensorFlow.js models to/from PostgreSQL.
// Models are stored as JSONB weight arrays in the ml_models table.

import { query } from "../../lib/db.js";

let tf;
async function ensureTF() {
  if (tf) return tf;
  tf = await import("@tensorflow/tfjs");
  return tf;
}

/**
 * Serialize a TF.js model's weights to a plain JSON-friendly array.
 */
async function serializeWeights(model) {
  await ensureTF();
  const weightData = [];
  for (const layer of model.layers) {
    const weights = layer.getWeights();
    for (const w of weights) {
      weightData.push({
        name: w.name,
        shape: Array.from(w.shape),
        data: Array.from(w.dataSync()),
      });
    }
  }
  return weightData;
}

/**
 * Strip TF.js auto-incremented numeric suffixes from weight names so that
 * stored weights can match a rebuilt model regardless of the global layer counter.
 * e.g. "dense_Dense8/kernel" -> "dense_Dense/kernel"
 *      "batch_normalization_BatchNormalization2/gamma" -> "batch_normalization_BatchNormalization/gamma"
 *      "gru_GRU3/kernel" -> "gru_GRU/kernel"
 */
function canonicalKey(name) {
  // Match layer-type names like Dense8, GRU3, BatchNormalization2 and strip the number
  return name.replace(/(\w+?)(\d+)(\/)/g, "$1$3");
}

/**
 * Restore weights into an existing TF.js model from serialized data.
 *
 * TF.js uses a global counter for layer names (Dense1, Dense2, ...). When multiple
 * models are loaded in one process, the counter keeps incrementing, so the rebuilt
 * model's weight names won't match what was stored at training time. We solve this
 * by matching on canonical keys (numeric suffix stripped) + occurrence order.
 *
 * Additionally, serializeWeights iterates layer.getWeights() which puts BN moving
 * stats inline, while model.weights puts non-trainable weights at the end. Matching
 * by canonical key handles this ordering difference.
 */
async function deserializeWeights(model, weightData) {
  await ensureTF();

  // First try exact name match (works when counter happens to align)
  const storedMap = new Map(weightData.map((w) => [w.name, w]));
  const allExact = model.weights.every((mw) => storedMap.has(mw.name));

  if (allExact) {
    const tensors = model.weights.map((mw) => {
      const stored = storedMap.get(mw.name);
      return tf.tensor(stored.data, stored.shape);
    });
    model.setWeights(tensors);
    tensors.forEach((t) => t.dispose());
    return;
  }

  // Canonical key matching: strip numeric suffixes, match by occurrence order
  // Build a map: canonicalKey -> [storedWeight1, storedWeight2, ...] in order
  const storedByCanonical = new Map();
  for (const w of weightData) {
    const ck = canonicalKey(w.name);
    if (!storedByCanonical.has(ck)) storedByCanonical.set(ck, []);
    storedByCanonical.get(ck).push(w);
  }

  // Track how many times each canonical key has been consumed
  const consumedCount = new Map();

  const tensors = model.weights.map((mw) => {
    const ck = canonicalKey(mw.name);
    const candidates = storedByCanonical.get(ck);
    const idx = consumedCount.get(ck) || 0;

    if (!candidates || idx >= candidates.length) {
      throw new Error(
        `Missing stored weight for ${mw.name} (canonical: ${ck}, occurrence ${idx}, expected shape ${mw.shape})`
      );
    }

    const stored = candidates[idx];
    consumedCount.set(ck, idx + 1);

    // Validate shape compatibility
    const expectedShape = JSON.stringify(Array.from(mw.shape));
    const storedShape = JSON.stringify(stored.shape);
    if (expectedShape !== storedShape) {
      throw new Error(
        `Shape mismatch for ${mw.name}: model expects ${expectedShape}, stored has ${storedShape}`
      );
    }

    return tf.tensor(stored.data, stored.shape);
  });

  model.setWeights(tensors);
  tensors.forEach((t) => t.dispose());
}

/**
 * Save a trained model to the ml_models table.
 *
 * @param {Object} model - TF.js model instance
 * @param {string} modelName - e.g. 'signal_quality_v1', 'stock_ranker_v1', 'lstm_v2'
 * @param {Object} options
 * @param {Object} options.architecture - JSON description of the model architecture
 * @param {Object} options.normalization - Feature normalization params (means, stds, mappings)
 * @param {Object} options.metrics - Training metrics { accuracy, val_loss, ... }
 * @param {number} options.trainingSamples - Number of training samples used
 */
export async function saveModel(model, modelName, options = {}) {
  const { architecture = {}, normalization = {}, metrics = {}, trainingSamples = 0 } = options;
  const weightData = await serializeWeights(model);

  // Get next version number
  const versionResult = await query(
    `SELECT COALESCE(MAX(model_version), 0) + 1 AS next_version
     FROM ml_models WHERE model_name = $1`,
    [modelName]
  );
  const nextVersion = versionResult.rows[0].next_version;

  // Deactivate previous versions
  await query(
    `UPDATE ml_models SET is_active = FALSE WHERE model_name = $1`,
    [modelName]
  );

  // Insert new version as active
  await query(
    `INSERT INTO ml_models
       (model_name, model_version, architecture, weights_json, normalization, metrics, training_samples, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
    [
      modelName,
      nextVersion,
      JSON.stringify(architecture),
      JSON.stringify(weightData),
      JSON.stringify(normalization),
      JSON.stringify(metrics),
      trainingSamples,
    ]
  );

  console.log(`[ML] Saved model ${modelName} v${nextVersion} (${weightData.length} weight arrays, ${trainingSamples} samples)`);
  return nextVersion;
}

/**
 * Load the active model from the database.
 * Returns null if no model exists.
 *
 * @param {string} modelName - e.g. 'signal_quality_v1'
 * @param {Function} buildModelFn - Function that takes architecture config and returns an uncompiled TF.js model
 * @returns {{ model, normalization, metrics, version } | null}
 */
export async function loadModel(modelName, buildModelFn) {
  const result = await query(
    `SELECT model_version, architecture, weights_json, normalization, metrics
     FROM ml_models
     WHERE model_name = $1 AND is_active = TRUE
     ORDER BY model_version DESC LIMIT 1`,
    [modelName]
  );

  if (result.rows.length === 0) {
    console.log(`[ML] No active model found for ${modelName}`);
    return null;
  }

  const row = result.rows[0];
  const architecture = typeof row.architecture === "string" ? JSON.parse(row.architecture) : row.architecture;
  const weightsJson = typeof row.weights_json === "string" ? JSON.parse(row.weights_json) : row.weights_json;
  const normalization = typeof row.normalization === "string" ? JSON.parse(row.normalization) : row.normalization;
  const metrics = typeof row.metrics === "string" ? JSON.parse(row.metrics) : row.metrics;

  const model = buildModelFn(architecture);
  await deserializeWeights(model, weightsJson);

  console.log(`[ML] Loaded model ${modelName} v${row.model_version}`);
  return {
    model,
    normalization: normalization || {},
    metrics: metrics || {},
    version: row.model_version,
  };
}

/**
 * Check if a model exists and return its metadata (without loading weights).
 */
export async function getModelInfo(modelName) {
  const result = await query(
    `SELECT model_version, training_samples, trained_at, metrics
     FROM ml_models
     WHERE model_name = $1 AND is_active = TRUE
     ORDER BY model_version DESC LIMIT 1`,
    [modelName]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    version: row.model_version,
    trainingSamples: row.training_samples,
    trainedAt: row.trained_at,
    metrics: typeof row.metrics === "string" ? JSON.parse(row.metrics) : row.metrics,
  };
}
