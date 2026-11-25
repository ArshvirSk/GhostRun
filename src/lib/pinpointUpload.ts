/**
 * GhostRun v3.0 Pinpoint Photo Uploader (UploadThing via Supabase Edge Function)
 *
 * Mints a presigned UploadThing v7 ingest URL via the `upload-pinpoint-photo`
 * Edge Function (keeping UPLOADTHING_TOKEN off the client) and uploads the
 * captured JPEG directly to UploadThing CDN.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import {
  buildPinpointPhotoFilename,
  isValidUploadThingUrl,
  type PinpointUploadResult,
} from './pinpointUploadCore';

export { buildPinpointPhotoFilename, isValidUploadThingUrl, type PinpointUploadResult };

/**
 * Uploads a local JPEG file URI (`file://...`) to UploadThing via the
 * `upload-pinpoint-photo` Supabase Edge Function.
 */
export async function uploadPinpointPhoto(
  localUri: string,
  meta?: { gameId?: string; roundId?: string; kind?: 'scout' | 'submission' }
): Promise<PinpointUploadResult> {
  if (!localUri || !supabase) {
    return { ok: false, error: 'Missing local URI or Supabase client' };
  }

  try {
    const info = await FileSystem.getInfoAsync(localUri);
    const fileSize = info.exists && typeof info.size === 'number' && info.size > 0 ? info.size : 1024;
    const fileName = buildPinpointPhotoFilename(meta);

    const { data, error } = await supabase.functions.invoke('upload-pinpoint-photo', {
      body: {
        fileName,
        fileSize,
        fileType: 'image/jpeg',
      },
    });

    if (error || !data?.uploadUrl || !data?.publicUrl) {
      const msg = error?.message || data?.error || 'Failed to prepare UploadThing upload';
      console.warn('[pinpointUpload] invoke failed:', msg);
      return {
        ok: false,
        error: msg,
      };
    }

    const uploadRes = await FileSystem.uploadAsync(data.uploadUrl, localUri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'image/jpeg',
    });

    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      const msg = `UploadThing ingest failed (${uploadRes.status}): ${uploadRes.body || ''}`;
      console.warn('[pinpointUpload] ingest failed:', msg);
      return {
        ok: false,
        error: msg,
      };
    }

    return {
      ok: true,
      publicUrl: data.publicUrl,
      key: data.key,
    };
  } catch (err: any) {
    const msg = err?.message || 'Pinpoint photo upload failed';
    console.warn('[pinpointUpload] exception:', msg);
    return {
      ok: false,
      error: msg,
    };
  }
}
