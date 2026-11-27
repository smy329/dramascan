/**
 * Image asset backup and recovery guidance module.
 *
 * Documents manual backup, download, restore of image asset directory. Ensures
 * database records and stored image paths consistent after restoration. No
 * external object storage or automatic external backup copy.
 *
 * Do not implement: automatic external backup copy, object storage integration,
 * or continuous sync with external services.
 */

import 'server-only';

/** Image asset backup guidance. */
export interface ImageAssetBackupGuidance {
  /** Description of backup process */
  description: string;
  /** Whether to backup image assets */
  backupImageAssets: boolean;
  /** Whether to restore image assets on database restore */
  restoreImageAssets: boolean;
  /** Whether to verify image paths after restore */
  verifyImagePaths: boolean;
  /** Maximum image file size in MB */
  maxImageFileSizeMB: number;
  /** Allowed image file types */
  allowedImageTypes: string[];
  /** Whether to use external object storage */
  useExternalObjectStorage: boolean;
  /** Documentation URL for manual backup/restore */
  documentationUrl: string;
}

/** Get image asset backup guidance. */
export function getImageAssetBackupGuidance(): ImageAssetBackupGuidance {
  return {
    description:
      'Manual guidance for backing up and restoring image asset directory',
    backupImageAssets: true,
    restoreImageAssets: true,
    verifyImagePaths: true,
    maxImageFileSizeMB: 10,
    allowedImageTypes: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    useExternalObjectStorage: false,
    documentationUrl: '/docs/backup-restore-guidance',
  };
}

/** Verify image path consistency after database restore. */
export function verifyImagePathConsistency(
  databaseRecords: Array<{ imagePath: string }>,
  filesystemFiles: Array<string>
): { consistent: boolean; missingFromDB: string[]; missingFromFS: string[] } {
  const missingFromDB: string[] = [];
  const missingFromFS: string[] = [];

  // Check which filesystem files are not in database records
  const dbPaths = new Set(databaseRecords.map(r => r.imagePath));
  for (const fsFile of filesystemFiles) {
    if (!dbPaths.has(fsFile)) {
      missingFromDB.push(fsFile);
    }
  }

  // Check which database records reference files not on filesystem
  for (const record of databaseRecords) {
    if (!filesystemFiles.includes(record.imagePath)) {
      missingFromFS.push(record.imagePath);
    }
  }

  return {
    consistent: missingFromDB.length === 0 && missingFromFS.length === 0,
    missingFromDB,
    missingFromFS,
  };
}