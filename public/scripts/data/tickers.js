// JPX sector labels (official buckets):
// - foods
// - energy_resources
// - construction_materials
// - raw_materials_chemicals
// - pharmaceutical
// - automobiles_transportation_equipment
// - steel_nonferrous_metals
// - machinery
// - electric_appliances_precision
// - it_services_others
// - electric_power_gas
// - transportation_logistics
// - commercial_wholesale_trade
// - retail_trade
// - banks
// - financials_ex_banks
// - real_estate

export const allTickers = [
  // =========================
  // automobiles_transportation_equipment
  // (includes Rubber Products + Transportation Equipment) :contentReference[oaicite:0]{index=0}
  // =========================
  {
    code: "7201.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7211.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7202.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7205.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7272.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "6902.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7259.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "6923.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "6473.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "5108.T",
    sector: "automobiles_transportation_equipment",
  }, // Rubber Products → included :contentReference[oaicite:1]{index=1}
  {
    code: "5101.T",
    sector: "automobiles_transportation_equipment",
  }, // Rubber Products → included :contentReference[oaicite:2]{index=2}
  {
    code: "7203.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7212.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7261.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7267.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7269.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7270.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7276.T",
    sector: "automobiles_transportation_equipment",
  },
  {
    code: "7309.T",
    sector: "automobiles_transportation_equipment",
  },

  // =========================
  // raw_materials_chemicals
  // (Textiles & Apparels / Pulp & Paper / Chemicals) :contentReference[oaicite:3]{index=3}
  // =========================
  { code: "3103.T", sector: "raw_materials_chemicals" },
  { code: "3861.T", sector: "raw_materials_chemicals" },
  { code: "3863.T", sector: "raw_materials_chemicals" },
  { code: "3864.T", sector: "raw_materials_chemicals" },
  { code: "3865.T", sector: "raw_materials_chemicals" },
  { code: "4004.T", sector: "raw_materials_chemicals" },
  { code: "4005.T", sector: "raw_materials_chemicals" },
  { code: "4021.T", sector: "raw_materials_chemicals" },
  { code: "4042.T", sector: "raw_materials_chemicals" },
  { code: "4043.T", sector: "raw_materials_chemicals" },
  { code: "4061.T", sector: "raw_materials_chemicals" },
  { code: "4063.T", sector: "raw_materials_chemicals" },
  { code: "4114.T", sector: "raw_materials_chemicals" },
  { code: "4118.T", sector: "raw_materials_chemicals" },
  { code: "4182.T", sector: "raw_materials_chemicals" },
  { code: "4183.T", sector: "raw_materials_chemicals" },
  { code: "4188.T", sector: "raw_materials_chemicals" },
  { code: "4204.T", sector: "raw_materials_chemicals" },
  { code: "4205.T", sector: "raw_materials_chemicals" },
  { code: "4208.T", sector: "raw_materials_chemicals" },
  { code: "4612.T", sector: "raw_materials_chemicals" },
  { code: "4613.T", sector: "raw_materials_chemicals" },
  { code: "4631.T", sector: "raw_materials_chemicals" },
  { code: "4634.T", sector: "raw_materials_chemicals" },
  { code: "6988.T", sector: "raw_materials_chemicals" },
  { code: "3110.T", sector: "raw_materials_chemicals" },
  { code: "3402.T", sector: "raw_materials_chemicals" },
  { code: "3401.T", sector: "raw_materials_chemicals" },
  { code: "3407.T", sector: "raw_materials_chemicals" },
  { code: "4206.T", sector: "raw_materials_chemicals" },
  { code: "4186.T", sector: "raw_materials_chemicals" },
  { code: "7911.T", sector: "raw_materials_chemicals" },
  { code: "7912.T", sector: "raw_materials_chemicals" },
  { code: "4452.T", sector: "raw_materials_chemicals" },
  { code: "4911.T", sector: "raw_materials_chemicals" },
  { code: "4912.T", sector: "raw_materials_chemicals" },
  { code: "4922.T", sector: "raw_materials_chemicals" },
  { code: "4927.T", sector: "raw_materials_chemicals" },

  // =========================
  // construction_materials
  // (Construction / Metal Products / Glass & Ceramics Products) :contentReference[oaicite:4]{index=4}
  // =========================
  { code: "5232.T", sector: "construction_materials" },
  { code: "5233.T", sector: "construction_materials" },
  { code: "5301.T", sector: "construction_materials" },
  { code: "5202.T", sector: "construction_materials" },
  { code: "5334.T", sector: "construction_materials" },
  { code: "5214.T", sector: "construction_materials" },
  { code: "1721.T", sector: "construction_materials" },
  { code: "1801.T", sector: "construction_materials" },
  { code: "1802.T", sector: "construction_materials" },
  { code: "1803.T", sector: "construction_materials" },
  { code: "1812.T", sector: "construction_materials" },
  { code: "1820.T", sector: "construction_materials" },
  { code: "1861.T", sector: "construction_materials" },
  { code: "1893.T", sector: "construction_materials" },
  { code: "1963.T", sector: "construction_materials" },
  { code: "5201.T", sector: "construction_materials" },
  { code: "5332.T", sector: "construction_materials" },
  { code: "5333.T", sector: "construction_materials" },
  { code: "1925.T", sector: "construction_materials" }, // JPX shows Sector = Construction :contentReference[oaicite:5]{index=5}

  // =========================
  // steel_nonferrous_metals
  // =========================
  { code: "5401.T", sector: "steel_nonferrous_metals" },
  { code: "5406.T", sector: "steel_nonferrous_metals" },
  { code: "5411.T", sector: "steel_nonferrous_metals" },
  { code: "5711.T", sector: "steel_nonferrous_metals" },
  { code: "5713.T", sector: "steel_nonferrous_metals" },
  { code: "5714.T", sector: "steel_nonferrous_metals" },
  { code: "5715.T", sector: "steel_nonferrous_metals" },
  { code: "5707.T", sector: "steel_nonferrous_metals" },
  { code: "5706.T", sector: "steel_nonferrous_metals" },
  { code: "5801.T", sector: "steel_nonferrous_metals" },
  { code: "5802.T", sector: "steel_nonferrous_metals" },
  { code: "5803.T", sector: "steel_nonferrous_metals" },
  { code: "5805.T", sector: "steel_nonferrous_metals" },
  { code: "3436.T", sector: "steel_nonferrous_metals" },

  // =========================
  // machinery
  // =========================
  { code: "5631.T", sector: "machinery" },
  { code: "6103.T", sector: "machinery" },
  { code: "6104.T", sector: "machinery" },
  { code: "6113.T", sector: "machinery" },
  { code: "6135.T", sector: "machinery" },
  { code: "6141.T", sector: "machinery" },
  { code: "6201.T", sector: "machinery" },
  { code: "6268.T", sector: "machinery" },
  { code: "6273.T", sector: "machinery" },
  { code: "6301.T", sector: "machinery" },
  { code: "6302.T", sector: "machinery" },
  { code: "6305.T", sector: "machinery" },
  { code: "6324.T", sector: "machinery" },
  { code: "6326.T", sector: "machinery" },
  { code: "6361.T", sector: "machinery" },
  { code: "6367.T", sector: "machinery" },
  { code: "6368.T", sector: "machinery" },
  { code: "6370.T", sector: "machinery" },
  { code: "6371.T", sector: "machinery" }, // (deduped)
  { code: "6383.T", sector: "machinery" },
  { code: "6407.T", sector: "machinery" },
  { code: "6465.T", sector: "machinery" },
  { code: "6472.T", sector: "machinery" },
  { code: "6586.T", sector: "machinery" },
  { code: "6728.T", sector: "machinery" },
  { code: "6925.T", sector: "machinery" },
  { code: "6954.T", sector: "machinery" },
  { code: "6955.T", sector: "machinery" },
  { code: "7003.T", sector: "machinery" },
  { code: "7004.T", sector: "machinery" },
  { code: "7011.T", sector: "machinery" },
  { code: "7012.T", sector: "machinery" },
  { code: "7013.T", sector: "machinery" },
  { code: "6471.T", sector: "machinery" },
  { code: "6323.T", sector: "machinery" },

  // =========================
  // electric_appliances_precision
  // =========================
  { code: "6448.T", sector: "electric_appliances_precision" },
  { code: "6501.T", sector: "electric_appliances_precision" },
  { code: "6503.T", sector: "electric_appliances_precision" },
  { code: "6504.T", sector: "electric_appliances_precision" },
  { code: "6506.T", sector: "electric_appliances_precision" },
  { code: "6508.T", sector: "electric_appliances_precision" },
  { code: "6526.T", sector: "electric_appliances_precision" },
  { code: "6594.T", sector: "electric_appliances_precision" },
  { code: "6841.T", sector: "electric_appliances_precision" },
  { code: "6971.T", sector: "electric_appliances_precision" },
  { code: "6146.T", sector: "electric_appliances_precision" },
  { code: "6479.T", sector: "electric_appliances_precision" },
  { code: "6645.T", sector: "electric_appliances_precision" },
  { code: "6670.T", sector: "electric_appliances_precision" },
  { code: "6701.T", sector: "electric_appliances_precision" },
  { code: "6702.T", sector: "electric_appliances_precision" },
  { code: "6707.T", sector: "electric_appliances_precision" },
  { code: "6723.T", sector: "electric_appliances_precision" },
  { code: "6724.T", sector: "electric_appliances_precision" },
  { code: "6727.T", sector: "electric_appliances_precision" },
  { code: "6752.T", sector: "electric_appliances_precision" },
  { code: "6753.T", sector: "electric_appliances_precision" },
  { code: "6754.T", sector: "electric_appliances_precision" },
  { code: "6758.T", sector: "electric_appliances_precision" },
  { code: "6762.T", sector: "electric_appliances_precision" },
  { code: "6770.T", sector: "electric_appliances_precision" },
  { code: "6857.T", sector: "electric_appliances_precision" },
  { code: "6861.T", sector: "electric_appliances_precision" },
  { code: "6866.T", sector: "electric_appliances_precision" },
  { code: "6890.T", sector: "electric_appliances_precision" },
  { code: "6920.T", sector: "electric_appliances_precision" },
  { code: "6927.T", sector: "electric_appliances_precision" },
  { code: "6952.T", sector: "electric_appliances_precision" },
  { code: "6963.T", sector: "electric_appliances_precision" },
  { code: "6965.T", sector: "electric_appliances_precision" },
  { code: "6966.T", sector: "electric_appliances_precision" },
  { code: "6976.T", sector: "electric_appliances_precision" },
  { code: "6981.T", sector: "electric_appliances_precision" },
  { code: "7729.T", sector: "electric_appliances_precision" },
  { code: "7701.T", sector: "electric_appliances_precision" },
  { code: "7735.T", sector: "electric_appliances_precision" },
  { code: "7751.T", sector: "electric_appliances_precision" },
  { code: "6632.T", sector: "electric_appliances_precision" },
  { code: "6674.T", sector: "electric_appliances_precision" },
  { code: "7731.T", sector: "electric_appliances_precision" },
  { code: "6869.T", sector: "electric_appliances_precision" },
  { code: "7733.T", sector: "electric_appliances_precision" },
  { code: "7741.T", sector: "electric_appliances_precision" },
  { code: "7747.T", sector: "electric_appliances_precision" },
  { code: "4062.T", sector: "electric_appliances_precision" },
  { code: "4901.T", sector: "electric_appliances_precision" },
  { code: "4902.T", sector: "electric_appliances_precision" },
  { code: "8035.T", sector: "electric_appliances_precision" },
  { code: "7951.T", sector: "electric_appliances_precision" },
  { code: "7762.T", sector: "electric_appliances_precision" },

  // =========================
  // it_services_others :contentReference[oaicite:6]{index=6}
  // =========================
  { code: "2371.T", sector: "it_services_others" },
  { code: "3626.T", sector: "it_services_others" },
  { code: "3635.T", sector: "it_services_others" },
  { code: "3656.T", sector: "it_services_others" },
  { code: "3659.T", sector: "it_services_others" },
  { code: "3774.T", sector: "it_services_others" },
  { code: "4324.T", sector: "it_services_others" },
  { code: "4676.T", sector: "it_services_others" },
  { code: "4751.T", sector: "it_services_others" },
  { code: "6098.T", sector: "it_services_others" },
  { code: "7974.T", sector: "it_services_others" },
  { code: "9424.T", sector: "it_services_others" },
  { code: "9432.T", sector: "it_services_others" },
  { code: "9433.T", sector: "it_services_others" },
  { code: "9434.T", sector: "it_services_others" },
  { code: "9436.T", sector: "it_services_others" },
  { code: "9449.T", sector: "it_services_others" },
  { code: "9468.T", sector: "it_services_others" },
  { code: "9602.T", sector: "it_services_others" },
  { code: "9684.T", sector: "it_services_others" },
  { code: "9697.T", sector: "it_services_others" },
  { code: "9766.T", sector: "it_services_others" },
  { code: "9984.T", sector: "it_services_others" },
  { code: "2124.T", sector: "it_services_others" },
  { code: "2181.T", sector: "it_services_others" },
  { code: "2410.T", sector: "it_services_others" },
  { code: "2432.T", sector: "it_services_others" },
  { code: "2475.T", sector: "it_services_others" },
  { code: "4384.T", sector: "it_services_others" },
  { code: "4666.T", sector: "it_services_others" },
  { code: "4848.T", sector: "it_services_others" },
  { code: "6028.T", sector: "it_services_others" },
  { code: "9435.T", sector: "it_services_others" },
  { code: "9735.T", sector: "it_services_others" },
  { code: "2326.T", sector: "it_services_others" },
  { code: "2327.T", sector: "it_services_others" },
  { code: "3697.T", sector: "it_services_others" },
  { code: "3769.T", sector: "it_services_others" },
  { code: "3994.T", sector: "it_services_others" },
  { code: "4307.T", sector: "it_services_others" },
  { code: "4443.T", sector: "it_services_others" },
  { code: "4477.T", sector: "it_services_others" },
  { code: "4478.T", sector: "it_services_others" },
  { code: "4704.T", sector: "it_services_others" },
  { code: "4812.T", sector: "it_services_others" },
  { code: "4684.T", sector: "it_services_others" },
  { code: "4686.T", sector: "it_services_others" },
  { code: "8056.T", sector: "it_services_others" },
  { code: "9719.T", sector: "it_services_others" },
  { code: "2175.T", sector: "it_services_others" },
  { code: "2413.T", sector: "it_services_others" },
  { code: "4755.T", sector: "it_services_others" },
  { code: "4689.T", sector: "it_services_others" },
  { code: "4661.T", sector: "it_services_others" },
  { code: "4680.T", sector: "it_services_others" },
  { code: "4681.T", sector: "it_services_others" },
  { code: "7832.T", sector: "it_services_others" },

  // =========================
  // retail_trade
  // =========================
  { code: "2670.T", sector: "retail_trade" },
  { code: "3048.T", sector: "retail_trade" },
  { code: "3064.T", sector: "retail_trade" },
  { code: "3086.T", sector: "retail_trade" },
  { code: "3092.T", sector: "retail_trade" },
  { code: "3099.T", sector: "retail_trade" },
  { code: "3197.T", sector: "retail_trade" },
  { code: "3387.T", sector: "retail_trade" },
  { code: "4385.T", sector: "retail_trade" },
  { code: "7453.T", sector: "retail_trade" },
  { code: "7564.T", sector: "retail_trade" },
  { code: "7581.T", sector: "retail_trade" },
  { code: "7616.T", sector: "retail_trade" },
  { code: "8016.T", sector: "retail_trade" },
  { code: "8218.T", sector: "retail_trade" },
  { code: "8227.T", sector: "retail_trade" },
  { code: "8233.T", sector: "retail_trade" },
  { code: "8267.T", sector: "retail_trade" },
  { code: "9439.T", sector: "retail_trade" },
  { code: "9843.T", sector: "retail_trade" },
  { code: "9982.T", sector: "retail_trade" },
  { code: "9983.T", sector: "retail_trade" },
  { code: "3046.T", sector: "retail_trade" },
  { code: "3088.T", sector: "retail_trade" },
  { code: "3141.T", sector: "retail_trade" },
  { code: "3349.T", sector: "retail_trade" },
  { code: "3391.T", sector: "retail_trade" },
  { code: "3549.T", sector: "retail_trade" },
  { code: "7649.T", sector: "retail_trade" },
  { code: "7532.T", sector: "retail_trade" },

  // =========================
  // foods
  // =========================
  { code: "1332.T", sector: "foods" },
  { code: "2002.T", sector: "foods" },
  { code: "2201.T", sector: "foods" },
  { code: "2206.T", sector: "foods" },
  { code: "2212.T", sector: "foods" },
  { code: "2229.T", sector: "foods" },
  { code: "2264.T", sector: "foods" },
  { code: "2267.T", sector: "foods" },
  { code: "2269.T", sector: "foods" },
  { code: "2281.T", sector: "foods" },
  { code: "2282.T", sector: "foods" },
  { code: "2501.T", sector: "foods" },
  { code: "2502.T", sector: "foods" },
  { code: "2503.T", sector: "foods" },
  { code: "2579.T", sector: "foods" },
  { code: "2587.T", sector: "foods" },
  { code: "2801.T", sector: "foods" },
  { code: "2802.T", sector: "foods" },
  { code: "2809.T", sector: "foods" },
  { code: "2811.T", sector: "foods" },
  { code: "2871.T", sector: "foods" },
  { code: "2875.T", sector: "foods" },
  { code: "2897.T", sector: "foods" },
  { code: "2914.T", sector: "foods" },
  { code: "2918.T", sector: "foods" },
  { code: "3038.T", sector: "foods" },

  // =========================
  // energy_resources
  // =========================
  { code: "1605.T", sector: "energy_resources" },
  { code: "5019.T", sector: "energy_resources" },
  { code: "5020.T", sector: "energy_resources" },
  { code: "5021.T", sector: "energy_resources" },

  // =========================
  // banks
  // =========================
  { code: "5831.T", sector: "banks" },
  { code: "7182.T", sector: "banks" },
  { code: "7186.T", sector: "banks" },
  { code: "7157.T", sector: "banks" },
  { code: "8304.T", sector: "banks" },
  { code: "8306.T", sector: "banks" },
  { code: "8308.T", sector: "banks" },
  { code: "8309.T", sector: "banks" },
  { code: "8316.T", sector: "banks" },
  { code: "8331.T", sector: "banks" },
  { code: "8354.T", sector: "banks" },
  { code: "8358.T", sector: "banks" },
  { code: "8410.T", sector: "banks" },
  { code: "8411.T", sector: "banks" },

  // =========================
  // financials_ex_banks
  // (Securities & Commodities / Insurance / Other Financing Business) :contentReference[oaicite:7]{index=7}
  // =========================
  { code: "6178.T", sector: "financials_ex_banks" },
  { code: "7181.T", sector: "financials_ex_banks" },
  { code: "7343.T", sector: "financials_ex_banks" },
  { code: "8252.T", sector: "financials_ex_banks" },
  { code: "8253.T", sector: "financials_ex_banks" },
  { code: "8473.T", sector: "financials_ex_banks" },
  { code: "8515.T", sector: "financials_ex_banks" },
  { code: "8570.T", sector: "financials_ex_banks" },
  { code: "8572.T", sector: "financials_ex_banks" },
  { code: "8584.T", sector: "financials_ex_banks" },
  { code: "8591.T", sector: "financials_ex_banks" },
  { code: "8593.T", sector: "financials_ex_banks" },
  { code: "8601.T", sector: "financials_ex_banks" },
  { code: "8604.T", sector: "financials_ex_banks" },
  { code: "8609.T", sector: "financials_ex_banks" },
  { code: "8630.T", sector: "financials_ex_banks" },
  { code: "8697.T", sector: "financials_ex_banks" }, // JPX is in “Other Financing Business” per factsheet example :contentReference[oaicite:8]{index=8}
  { code: "8698.T", sector: "financials_ex_banks" },
  { code: "8725.T", sector: "financials_ex_banks" },
  { code: "8750.T", sector: "financials_ex_banks" },
  { code: "8766.T", sector: "financials_ex_banks" },
  { code: "8795.T", sector: "financials_ex_banks" },
  { code: "8798.T", sector: "financials_ex_banks" },
  { code: "7172.T", sector: "financials_ex_banks" },

  // =========================
  // pharmaceutical
  // =========================
  { code: "4151.T", sector: "pharmaceutical" },
  { code: "4502.T", sector: "pharmaceutical" },
  { code: "4503.T", sector: "pharmaceutical" },
  { code: "4506.T", sector: "pharmaceutical" },
  { code: "4507.T", sector: "pharmaceutical" },
  { code: "4516.T", sector: "pharmaceutical" },
  { code: "4519.T", sector: "pharmaceutical" },
  { code: "4521.T", sector: "pharmaceutical" },
  { code: "4523.T", sector: "pharmaceutical" },
  { code: "4528.T", sector: "pharmaceutical" },
  { code: "4530.T", sector: "pharmaceutical" },
  { code: "4536.T", sector: "pharmaceutical" },
  { code: "4553.T", sector: "pharmaceutical" },
  { code: "4565.T", sector: "pharmaceutical" },
  { code: "4568.T", sector: "pharmaceutical" },
  { code: "4574.T", sector: "pharmaceutical" },
  { code: "4578.T", sector: "pharmaceutical" },
  { code: "4587.T", sector: "pharmaceutical" },
  { code: "4974.T", sector: "pharmaceutical" },

  // =========================
  // commercial_wholesale_trade
  // =========================
  { code: "2768.T", sector: "commercial_wholesale_trade" },
  { code: "8001.T", sector: "commercial_wholesale_trade" },
  { code: "8002.T", sector: "commercial_wholesale_trade" },
  { code: "8015.T", sector: "commercial_wholesale_trade" },
  { code: "8020.T", sector: "commercial_wholesale_trade" },
  { code: "8031.T", sector: "commercial_wholesale_trade" },
  { code: "8053.T", sector: "commercial_wholesale_trade" },
  { code: "8058.T", sector: "commercial_wholesale_trade" },
  { code: "8078.T", sector: "commercial_wholesale_trade" },
  { code: "2760.T", sector: "commercial_wholesale_trade" },
  { code: "3132.T", sector: "commercial_wholesale_trade" },
  { code: "7459.T", sector: "commercial_wholesale_trade" },
  { code: "9962.T", sector: "commercial_wholesale_trade" }, // Wholesale (official) :contentReference[oaicite:9]{index=9}

  // =========================
  // transportation_logistics
  // =========================
  { code: "9001.T", sector: "transportation_logistics" },
  { code: "9005.T", sector: "transportation_logistics" },
  { code: "9006.T", sector: "transportation_logistics" },
  { code: "9007.T", sector: "transportation_logistics" },
  { code: "9008.T", sector: "transportation_logistics" },
  { code: "9009.T", sector: "transportation_logistics" },
  { code: "9020.T", sector: "transportation_logistics" },
  { code: "9021.T", sector: "transportation_logistics" },
  { code: "9022.T", sector: "transportation_logistics" },
  { code: "9024.T", sector: "transportation_logistics" },
  { code: "9041.T", sector: "transportation_logistics" },
  { code: "9042.T", sector: "transportation_logistics" },
  { code: "9044.T", sector: "transportation_logistics" },
  { code: "9048.T", sector: "transportation_logistics" },
  { code: "9064.T", sector: "transportation_logistics" },
  { code: "9065.T", sector: "transportation_logistics" },
  { code: "9069.T", sector: "transportation_logistics" },
  { code: "9076.T", sector: "transportation_logistics" },
  { code: "9101.T", sector: "transportation_logistics" },
  { code: "9104.T", sector: "transportation_logistics" },
  { code: "9107.T", sector: "transportation_logistics" },
  { code: "9110.T", sector: "transportation_logistics" },
  { code: "9119.T", sector: "transportation_logistics" },
  { code: "9142.T", sector: "transportation_logistics" },
  { code: "9143.T", sector: "transportation_logistics" },
  { code: "9147.T", sector: "transportation_logistics" },
  { code: "9201.T", sector: "transportation_logistics" },
  { code: "9202.T", sector: "transportation_logistics" },
  { code: "9204.T", sector: "transportation_logistics" },
  { code: "9301.T", sector: "transportation_logistics" },
  { code: "9302.T", sector: "transportation_logistics" },
  { code: "9303.T", sector: "transportation_logistics" },

  // =========================
  // real_estate
  // =========================
  { code: "3231.T", sector: "real_estate" },
  { code: "3281.T", sector: "real_estate" },
  { code: "3282.T", sector: "real_estate" },
  { code: "3288.T", sector: "real_estate" },
  { code: "3289.T", sector: "real_estate" },
  { code: "3462.T", sector: "real_estate" },
  { code: "8801.T", sector: "real_estate" },
  { code: "8802.T", sector: "real_estate" },
  { code: "8804.T", sector: "real_estate" },
  { code: "8830.T", sector: "real_estate" },

  // =========================
  // electric_power_gas
  // =========================
  { code: "9501.T", sector: "electric_power_gas" },
  { code: "9502.T", sector: "electric_power_gas" },
  { code: "9503.T", sector: "electric_power_gas" },
  { code: "9504.T", sector: "electric_power_gas" },
  { code: "9505.T", sector: "electric_power_gas" },
  { code: "9506.T", sector: "electric_power_gas" },
  { code: "9507.T", sector: "electric_power_gas" },
  { code: "9508.T", sector: "electric_power_gas" },
  { code: "9509.T", sector: "electric_power_gas" },
  { code: "9513.T", sector: "electric_power_gas" },
  { code: "9517.T", sector: "electric_power_gas" },
  { code: "9519.T", sector: "electric_power_gas" },
  { code: "9531.T", sector: "electric_power_gas" },
  { code: "9532.T", sector: "electric_power_gas" },
  { code: "9533.T", sector: "electric_power_gas" },
];
