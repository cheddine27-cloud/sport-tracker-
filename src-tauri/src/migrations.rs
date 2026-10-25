use tauri_plugin_sql::{Migration, MigrationKind};

/// SQL migrations registered in Rust so the database is created
/// automatically on first launch of the desktop app.
///
/// The SQL lives in `src-tauri/migrations/*.sql` (included at compile time)
/// so the same files can be reused by the Node test harness.
pub fn get_migrations() -> Vec<Migration> {
    let migration_1 = include_str!("../migrations/001_schema.sql");
    let migration_2 = include_str!("../migrations/002_seed.sql");

    vec![
        Migration {
            version: 1,
            description: "create_tables",
            sql: migration_1,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "seed_default_data",
            sql: migration_2,
            kind: MigrationKind::Up,
        },
    ]
}

