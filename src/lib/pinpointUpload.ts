/**
 * GhostRun v3.0 Pinpoint Photo Uploader (UploadThing via Supabase Edge Function)
 *
 * Mints a presigned UploadThing v7 ingest URL via the `upload-pinpoint-photo`
 * Edge Function (keeping UPLOADTHING_TOKEN off the client) and uploads the
 * captured JPEG directly to UploadThing CDN.
 */

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
    const fileRes = await fetch(localUri);
    const blob = await fileRes.blob();
    const fileSize = blob.size > 0 ? blob.size : 1024;
    const fileName = buildPinpointPhotoFilename(meta);

    const { data, error } = await supabase.functions.invoke('upload-pinpoint-photo', {
      body: {
        fileName,
        fileSize,
        fileType: 'image/jpeg',
      },
    });

    if (error || !data?.uploadUrl || !data?.publicUrl) {
      return {
        ok: false,
        error: error?.message || data?.error || 'Failed to prepare UploadThing upload',
      };
    }

    const formData = new FormData();
    formData.append('file', {
      uri: localUri,
      name: fileName,
      type: 'image/jpeg',
    } as any);

    const uploadRes = await fetch(data.uploadUrl, {
      method: 'PUT',
      body: formData,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      return {
        ok: false,
        error: `UploadThing ingest failed (${uploadRes.status}): ${errText}`,
      };
    }

    return {
      ok: true,
      publicUrl: data.publicUrl,
      key: data.key,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Pinpoint photo upload failed',
    };
  }
}
