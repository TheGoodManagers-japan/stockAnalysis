"use client";
import styles from "./Modal.module.css";

export default function Modal({ isOpen, onClose, title, maxWidth = 600, children }) {
  if (!isOpen) return null;
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.content}
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className={styles.header}>
            <h3>{title}</h3>
            <button className={styles.close} onClick={onClose}>
              &times;
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
