const objectUrl = /^https:\/\/it37\.eldis24\.ru\/main\/object\/[\da-fA-F]{8}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{4}-[\da-fA-F]{12}$/;

export function isEldisObjectUrl(value: string): boolean {
  return objectUrl.test(value);
}

export function EldisLink({ url }: { url?: string | null }) {
  if (!url || !isEldisObjectUrl(url)) return null;
  return <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 4, color: 'var(--primary)' }}>Открыть в Элдисе</a>;
}
