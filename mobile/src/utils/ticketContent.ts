export const isHttpUrl = (value: string): boolean => /^https?:\/\/\S+$/i.test(value.trim());

export const buildCommentWithLink = (comment: string, linkTitle: string, linkUrl: string): string => {
  const parts: string[] = [];
  const cleanComment = comment.trim();
  const cleanUrl = linkUrl.trim();
  if (cleanComment) parts.push(cleanComment);
  if (cleanUrl) parts.push(linkTitle.trim() ? `[${linkTitle.trim()}](${cleanUrl})` : cleanUrl);
  return parts.join('\n');
};
