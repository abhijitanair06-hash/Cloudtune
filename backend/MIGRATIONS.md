# Database migrations

CloudTune uses Alembic for schema changes. Do not rely on SQLAlchemy
`create_all()` to add columns to existing tables.

## Local setup

Run these commands from the `backend` directory with the project virtual
environment activated and `backend/.env` configured:

```powershell
alembic upgrade head
alembic current
```

The old `python -m app.db.init_db` command is retained as a compatibility
wrapper around `alembic upgrade head`.

## Existing databases

The first migration is an idempotent baseline: it creates missing tables and
indexes while leaving tables that already exist in place. It repairs a missing
`songs.uploaded_by` column by assigning legacy rows to the earliest existing
user account. If there are songs but no user account to own them, migration
stops rather than inventing an owner. Back up the database before migrations.

## New schema changes

Create a revision instead of editing an applied revision:

```powershell
alembic revision --autogenerate -m "describe the schema change"
```

Review the generated file, especially foreign keys, defaults and data
backfills, then apply it with `alembic upgrade head`. Never put secret values
or user audio into migration files.
