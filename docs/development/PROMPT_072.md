# Prompt 072 — Content Trash Implementation

## Overview
Implement soft deletion (Trash) for dramas, seasons, episodes, and movies. Authorized non-Super Admin roles may move content into Trash. Permanent deletion and restoration privileges follow approved role rules.

## Changes Made

### 1. `src/workflows/admin/dramas.ts` — Enhanced `deleteDrama`
- **Before**: Simple soft-delete setting `deleted_at`
- **After**: Shows affected child records (seasons, episodes) before deletion, reports counts
- **New return type**: `{ ok: true; affectedSeasons: number; affectedEpisodes: number }` or error with counts

### 2. `src/workflows/admin/restore.ts` [NEW] — Restore functions
- `restoreDrama`: Restores a trashed drama, recovering its hierarchy (seasons, episodes)
- `restoreSeason`: Restores a trashed season, recovering its episode hierarchy
- `restoreEpisode`: Restores a trashed episode
- `restoreMovie`: Restores a trashed movie
- All use the same manage permission as their corresponding delete functions (`drama.manage`, `season.manage`, `episode.manage`, `movie.manage`)
- Re-activates rows by clearing `deleted_at`

### 3. `src/workflows/admin/permanent-delete.ts` [NEW] — Permanent deletion
- `permanentDeleteDrama`: Super Admin only, checks dependencies (seasons, episodes, categories, platforms, similar_dramas, slug history), then permanently deletes
- `permanentDeleteSeason`: Super Admin only, checks dependent episodes and similar_dramas references through the season's drama
- `permanentDeleteEpisode`: Super Admin only, checks dependent seasons, similar_dramas, and slug history
- `permanentDeleteMovie`: Super Admin only, checks dependent categories, platforms, and slug history
- All functions verify the target is currently in Trash before allowing permanent deletion
- Returns dependent record counts so administrators can review before confirming

## Key Design Decisions

1. **Hierarchy preservation**: Soft delete (`deleted_at`) preserves all relationships for restoration. When a drama is trashed, its seasons and episodes are also marked trashed but their `season_id`/`drama_id` links are preserved.

2. **Show affected children before destructive operation**: Before permanently deleting, the system lists all affected child records (seasons, episodes, categories, platforms, similar entries, slug history) so the administrator can review.

3. **Role-based access control**:
   - Non-Super Admin roles with `drama.manage`, `season.manage`, `episode.manage`, `movie.manage` permissions can move content into Trash (soft delete)
   - Super Admin only can permanently delete content (via `requireSuperAdmin`)
   - Restoration is available to authorized administrators who have the manage permission

4. **Permanent delete cleanup**: Before irreversible deletion, checks and reports:
   - Associated seasons/episodes (for dramas)
   - Dependent similar_drama references
   - Category/platform associations
   - Slug history entries
   - Verifies target is in Trash state

## Files Modified/Created

- `src/workflows/admin/dramas.ts` — Enhanced `deleteDrama` with affected records
- `src/workflows/admin/restore.ts` [NEW] — Restore functions for all content types
- `src/workflows/admin/permanent-delete.ts` [NEW] — Permanent deletion functions (Super Admin only)
- `docs/development/PROMPT_072.md` [NEW] — Implementation documentation

## Test Results

- **Typecheck**: PASS
- **Lint**: PASS  
- **Unit tests**: 802/802 PASS
- **Integration tests**: 497/497 PASS
- **E2E tests**: Infrastructure verified (server started with TEST_DATABASE_URL)

## Git

- Commit: `b5710f1` — "feat: implement content trash for dramas, seasons, episodes and movies (Prompt 072)"
- Pushed to: `origin/main`