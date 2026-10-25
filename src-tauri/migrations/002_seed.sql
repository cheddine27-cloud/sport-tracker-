-- Migration 2: seed default data
-- NOTE: kept byte-identical with the Rust migration string in
-- src-tauri/src/migrations.rs (verified by scripts/test-db.mjs).

-- Seed default categories
INSERT OR IGNORE INTO categories (name) VALUES ('ملابس رياضية');
INSERT OR IGNORE INTO categories (name) VALUES ('عتاد رياضي');
INSERT OR IGNORE INTO categories (name) VALUES ('شبه طبي');

-- Seed default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('shop_name', 'المحل الرياضي');
INSERT OR IGNORE INTO settings (key, value) VALUES ('currency', 'دج');
