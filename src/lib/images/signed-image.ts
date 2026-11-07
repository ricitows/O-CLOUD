export const SIGNED_IMAGE_TTL_SECONDS = 30 * 60;
export const SIGNED_IMAGE_UNAVAILABLE_MESSAGE = 'No se pudo preparar el enlace privado de esta imagen. Vuelve a cargar la sección para intentarlo de nuevo.';

export type SignedImageResult = { url: string | null; error: string | null };

type SignedUrlResponse = {
  data: { signedUrl?: string } | null;
  error?: unknown;
};

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const details = error as { code?: unknown; statusCode?: unknown };
  const value = typeof details.code === 'string' ? details.code : details.statusCode;
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value) ? value : undefined;
}

export async function resolveSignedImageUrl(createUrl: () => Promise<SignedUrlResponse>): Promise<SignedImageResult> {
  try {
    const { data, error } = await createUrl();
    if (error || typeof data?.signedUrl !== 'string' || !data.signedUrl) {
      console.warn('[private-image-url] Could not create a signed image URL.', {
        code: safeErrorCode(error),
        reason: error ? 'storage_error' : 'missing_url',
      });
      return { url: null, error: SIGNED_IMAGE_UNAVAILABLE_MESSAGE };
    }
    return { url: data.signedUrl, error: null };
  } catch {
    console.warn('[private-image-url] Could not create a signed image URL.', { reason: 'request_failed' });
    return { url: null, error: SIGNED_IMAGE_UNAVAILABLE_MESSAGE };
  }
}
