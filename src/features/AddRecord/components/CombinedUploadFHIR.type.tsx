import type { FHIRWithValidation } from '../services/fhirConversionService.type';
import { FileObject, VirtualFileInput } from '@/types/core';
import { UploadResult } from '../services/shared.types';
import { ProcessFileOptions, UploadFilesOptions } from '../hooks/useFileManager.type';

// ============================================================================
// FILE MANAGEMENT TYPES
// ============================================================================

/**
 * File statistics interface matching useFileUpload hook exactly
 */
export interface FileStats {
  total: number;
  processing: number;
  completed: number;
  errors: number;
  percentComplete: number;
}

export interface AddFilesOptions {
  maxFiles?: number;
  maxSizeBytes?: number;
}

export interface VirtualFileResult {
  fileId: string;
  virtualFile: FileObject;
  uploadResult?: any;
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

export interface CombinedUploadFHIRProps {
  // File management props - UPDATED to match hook exactly
  files: FileObject[];
  addFiles: (fileList: FileList, options?: AddFilesOptions) => void;
  removeFile: (fileId: string) => Promise<void>;
  removeFileFromLocal: (fileId: string) => void;

  // Updated: Hook provides Promise<void>, takes fileId: string
  retryFile: (fileId: string) => Promise<void>;

  // Updated: Hook provides the full FileStats interface
  getStats: () => FileStats;

  onReview: (fileItem: FileObject, viewMode?: string) => void;
  processFile: (fileObj: FileObject, options?: ProcessFileOptions) => Promise<FileObject>;

  // Direct upload functions
  addFhirAsVirtualFile: (
    fhirData: FHIRWithValidation,
    options?: VirtualFileInput & { autoUpload?: boolean }
  ) => Promise<VirtualFileResult>;
  uploadFiles: (
    filesToUpload: FileObject[],
    options?: UploadFilesOptions
  ) => Promise<UploadResult[]>;
  savingToFirestore: Set<string>;

  // Configuration props
  acceptedTypes?: string[];
  maxFiles?: number;
  maxSizeBytes?: number;
  className?: string;

  convertTextToFHIR?: (text: string, patientName?: string) => Promise<FHIRWithValidation>;

  isGuest: boolean;
}
