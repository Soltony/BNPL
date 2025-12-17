export async function extractErrorMessage(response: Response, defaultMsg: string) {
  if (response.status === 401) return 'You must be signed in to perform this action. Please sign in and try again.';
  if (response.status === 403) return 'Not authorized to perform this action.';

  try {
    const data = await response.json();
    if (data && data.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    return JSON.stringify(data);
  } catch (e) {
    try {
      const text = await response.text();
      if (text) {
        const stripped = text.replace(/<[^>]*>/g, '');
        return stripped.length > 200 ? stripped.substring(0, 200) + '...' : stripped;
      }
    } catch (_e) {
      // ignore
    }
  }
  return defaultMsg;
}

export async function postPendingChange(body: any, defaultMsg = 'Failed to submit changes for approval.') {
  const resp = await fetch('/api/settings/pending-changes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const msg = await extractErrorMessage(resp, defaultMsg);
    throw new Error(msg);
  }

  return resp;
}
