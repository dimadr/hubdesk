import { api } from './client';
import { AttachmentResponse } from './types';

export const uploadTicketPhoto = async (
  ticketId: number,
  uri: string,
  filename = `photo-${Date.now()}.jpg`,
): Promise<AttachmentResponse> => {
  const form = new FormData();
  form.append('file', { uri, type: 'image/jpeg', name: filename } as unknown as Blob);
  form.append('ticket_id', String(ticketId));
  const { data } = await api.post<AttachmentResponse>('/attachments', form);
  return data;
};
