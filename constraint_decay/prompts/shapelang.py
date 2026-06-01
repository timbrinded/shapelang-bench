"""ShapeLang condition.

The `shapelang` arm gives the agent the actual ShapeLang skill (mounted at
/shape-skill) plus the `shp` CLI (on PATH), and instructs it to author and
maintain a Shape architecture model and keep it valid as it works. This is the
skill itself — NOT a pre-written contract pasted into the prompt — so we measure
the agent *using* ShapeLang, not copying a fixed artifact.

The `control` arm gets none of this (no instruction, no skill/shp mounts), so it
provably cannot see ShapeLang.
"""

# Host paths mounted read-only into the conduit container for the shapelang arm.
SHAPE_SKILL_HOST_PATH = "/home/timbo/.claude/skills/shape-lang"
SHAPE_SKILL_CONTAINER_PATH = "/shape-skill"
SHP_BIN_HOST_PATH = "/home/timbo/.local/bin/shp"
SHP_BIN_CONTAINER_PATH = "/usr/local/bin/shp"

SHAPELANG_INSTRUCTION = f"""## Use ShapeLang

A ShapeLang skill is installed at `{SHAPE_SKILL_CONTAINER_PATH}` and the `shp`
CLI is on your PATH. Read `{SHAPE_SKILL_CONTAINER_PATH}/SKILL.md` and the guides
it references, then USE ShapeLang as you build this service:

- Author and maintain a Shape architecture model under `shape/*.shape` that
  reflects this service's components, resources, relations, and effects.
- Use `shp` as you work — at minimum `shp fmt --check` and `shp check` — and keep
  the model valid and consistent with the code.
- Treat the Shape model as the source of truth for architecture: before adding or
  changing code, consult it, update it, and re-run `shp check` so the
  implementation cannot silently drift from the contract.
"""


def shapelang_volumes() -> list[str]:
    """Read-only docker -v mounts that give the shapelang arm the skill + shp."""
    return [
        f"{SHAPE_SKILL_HOST_PATH}:{SHAPE_SKILL_CONTAINER_PATH}:ro",
        f"{SHP_BIN_HOST_PATH}:{SHP_BIN_CONTAINER_PATH}:ro",
    ]
