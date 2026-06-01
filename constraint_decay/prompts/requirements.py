REQUIREMENTS_TEMPLATE = """## Requirements

- You MUST use the **{framework}** framework.
- You MUST work in the current directory.
{additional_requirements}
"""

ARCHITECTURE_REQUIREMENT = "- You MUST follow the architecture described below."

DATABASE_REQUIREMENT = "- You MUST use the database as described below."

SQLALCHEMY_REQUIREMENT = "- You MUST use the SQLAlchemy Python ORM for handling the database."

SEQUELIZE_REQUIREMENT = "- You MUST use the Sequelize Node ORM for handling the database."

GORM_REQUIREMENT = "- You MUST use GORM (gorm.io/gorm) as the Go ORM for handling the database."

SEAORM_REQUIREMENT = "- You MUST use SeaORM (sea-orm) as the Rust ORM for handling the database."
