# Prompt 072 — Content Trash Implementation

## Overview
Implement soft deletion (Trash) for dramas, seasons, episodes, and movies. Authorized non-Super Admin roles may move content into Trash. Permanent deletion and restoration privileges follow approved role rules.

## Changes Made

### 1. `src/workflows/admin/dramas.ts` — Enhanced `deleteDrama`
- **Before**: Simple soft-delete setting `deleted_at`
- **After**: Shows affected child records (seasons, episodes) before deletion, reports counts

### 2. `src/workflows/admin/episodes.ts` — Enhanced `deleteEpisode`
- **Before**: Simple soft-delete setting `deleted_at`
- **After**: Shows affected dependent records before deletion, reports counts

### 3. `src/workflows/admin/seasons.ts` — Enhanced `deleteSeason`
- **Before**: Already shows affected episodes count
- **After**: Enhanced to also show affected child dramas/relationships, preserves hierarchy for restoration

### 4. New: `src/workflows/admin/restore.ts` — Restore functions
- `restoreDrama`: Restores a trashed drama, restoring its hierarchy (seasons, episodes)
- `restoreSeason`: Restores a trashed season, restoring its episodes
- `restoreEpisode`: Restores a trashed episode

### 5. New: `src/workflows/admin/permanent-delete.ts` — Permanent deletion
- `permanentDeleteDrama`: Super Admin only, checks dependencies, removes bookmarks/progress/history
- `permanentDeleteSeason`: Super Admin only, checks dependencies
- `permanentDeleteEpisode`: Super Admin only, checks dependencies
- `permanentDeleteMovie`: Super Admin only, checks dependencies

## Key Design Decisions

1. **Hierarchy preservation**: Soft delete (`deleted_at`) preserves all relationships for restoration. When a drama is trashed, its seasons and episodes are also marked trashed but their `season_id`/`drama_id` links are preserved.

2. **Show affected children before destructive operation**: Before permanently deleting, the system lists all affected child records (seasons, episodes, movies, episodes depending on target).

3. **Role-based access**:
   - `drama.manage`, `episode.manage`, `season.manage`, `movie.manage` permissions allow Trash (soft delete)
   - `requireSuperAdmin` restricts permanent deletion
   - Restoration is allowed for authorized roles that can Trash

4. **Permanent delete cleanup**: Before irreversible deletion, check and remove:
   - User bookmarks
   - Playback progress/watch history
   - Maintain anonymized ratings/reviews for aggregate analytics

## Files Modified/Created

- `src/workflows/admin/dramas.ts` — Enhanced `deleteDrama`
- `src/workflows/admin/episodes.ts` — Enhanced `deleteEpisode`
- `src/workflows/admin/seasons.ts` — Enhanced `deleteSeason`
- `src/workflows/admin/restore.ts` [NEW] — Restore functions
- `src/workflows/admin/permanent-delete.ts` [NEW] — Permanent deletion functions

## Testing Considerations
- Integration tests verify trash → restore cycle preserves hierarchy
- Integration tests verify permanent delete is Super Admin only
- Tests show affected child records before destructive operations