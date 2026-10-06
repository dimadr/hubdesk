import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

type FieldType = 'checkbox' | 'text' | 'number' | 'photo' | 'signature';

interface ChecklistField {
  id: number;
  label: string;
  field_type: FieldType;
  is_mandatory: boolean;
  value: string | null;
}

interface Checklist {
  id: number;
  name: string;
  fields: ChecklistField[];
}

interface FieldDraft {
  label: string;
  fieldType: FieldType;
  mandatory: boolean;
}

interface Props {
  ticketId: number;
  canEdit: boolean;
  onChanged?: () => void;
}

const emptyDraft = (): FieldDraft => ({ label: '', fieldType: 'checkbox', mandatory: false });

export const TicketChecklist: React.FC<Props> = ({ ticketId, canEdit, onChanged }) => {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [values, setValues] = useState<Record<number, string>>({});
  const [drafts, setDrafts] = useState<Record<number, FieldDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const { data } = await api.get<Checklist[]>(`/tickets/${ticketId}/checklists`);
      setChecklists(data);
      setValues(Object.fromEntries(data.flatMap((checklist) => checklist.fields.map((field) => [field.id, field.value || '']))));
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Не удалось загрузить чек-лист');
    }
  };

  useEffect(() => { load(); }, [ticketId]);

  const saveField = async (checklistId: number, fieldId: number, value: string) => {
    setBusy(true);
    try {
      await api.patch(`/tickets/${ticketId}/checklist/${checklistId}/field/${fieldId}`, { value });
      setValues((current) => ({ ...current, [fieldId]: value }));
      setError('');
      onChanged?.();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Не удалось сохранить поле');
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (checklistId: number, fieldId: number, file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('ticket_id', String(ticketId));
      const { data } = await api.post('/attachments', form);
      const value = `Фото: ${data.filename}`;
      await api.patch(`/tickets/${ticketId}/checklist/${checklistId}/field/${fieldId}`, { value });
      setValues((current) => ({ ...current, [fieldId]: value }));
      setError('');
      onChanged?.();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Не удалось загрузить фото');
    } finally {
      setBusy(false);
    }
  };

  const addChecklist = async () => {
    setBusy(true);
    try {
      await api.post(`/tickets/${ticketId}/checklist`);
      await load();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Не удалось добавить чек-лист');
    } finally {
      setBusy(false);
    }
  };

  const addField = async (checklistId: number) => {
    const draft = drafts[checklistId] || emptyDraft();
    if (!draft.label.trim()) return;
    setBusy(true);
    try {
      await api.post(`/tickets/${ticketId}/checklist/${checklistId}/fields`, {
        label: draft.label.trim(),
        field_type: draft.fieldType,
        is_mandatory: draft.mandatory,
      });
      setDrafts((current) => ({ ...current, [checklistId]: emptyDraft() }));
      await load();
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Не удалось добавить поле');
    } finally {
      setBusy(false);
    }
  };

  const renderField = (checklistId: number, field: ChecklistField) => {
    const value = values[field.id] || '';
    const label = <span className="checklist-field-label">{field.label}{field.is_mandatory ? ' *' : ''}</span>;
    if (field.field_type === 'checkbox') {
      const checked = ['true', '1', 'да'].includes(value.toLowerCase());
      return (
        <label className="checklist-checkbox">
          <input type="checkbox" checked={checked} disabled={!canEdit || busy} onChange={() => saveField(checklistId, field.id, checked ? 'false' : 'true')} />
          {label}
        </label>
      );
    }
    if (field.field_type === 'photo') {
      return (
        <div className="checklist-field-row">
          <div>{label}{value && <div className="checklist-saved-value">{value}</div>}</div>
          {canEdit && <label className="btn btn-secondary checklist-photo-button">Фото<input type="file" accept="image/*" disabled={busy} onChange={(e) => { uploadPhoto(checklistId, field.id, e.target.files?.[0]); e.target.value = ''; }} /></label>}
        </div>
      );
    }
    if (!canEdit) {
      return <div className="checklist-field-row"><div>{label}<div className="checklist-saved-value">{value || '—'}</div></div></div>;
    }
    return (
      <div className="checklist-field-edit">
        {label}
        <div className="checklist-input-row">
          <input
            type={field.field_type === 'number' ? 'number' : 'text'}
            value={value}
            disabled={busy}
            onChange={(e) => setValues((current) => ({ ...current, [field.id]: e.target.value }))}
          />
          <button className="btn btn-secondary" disabled={busy} onClick={() => saveField(checklistId, field.id, value)}>Сохранить</button>
        </div>
      </div>
    );
  };

  return (
    <section className="ticket-checklists">
      <div className="ticket-checklists-header">
        <span>Чек-листы</span>
        {canEdit && <button className="btn btn-secondary" disabled={busy} onClick={addChecklist}>+ Чек-лист</button>}
      </div>
      {error && <div className="modal-error">{error}</div>}
      {!checklists.length && <div className="checklist-empty">Нет чек-листов</div>}
      {checklists.map((checklist) => {
        const draft = drafts[checklist.id] || emptyDraft();
        return (
          <div className="ticket-checklist" key={checklist.id}>
            <div className="ticket-checklist-name">{checklist.name}</div>
            {checklist.fields.map((field) => <div className="ticket-checklist-field" key={field.id}>{renderField(checklist.id, field)}</div>)}
            {!checklist.fields.length && <div className="checklist-empty">Нет полей</div>}
            {canEdit && (
              <div className="checklist-add-field">
                <input placeholder="Название поля" value={draft.label} onChange={(e) => setDrafts((current) => ({ ...current, [checklist.id]: { ...draft, label: e.target.value } }))} />
                <select value={draft.fieldType} onChange={(e) => setDrafts((current) => ({ ...current, [checklist.id]: { ...draft, fieldType: e.target.value as FieldType } }))}>
                  <option value="checkbox">Галочка</option>
                  <option value="text">Текст</option>
                  <option value="number">Число</option>
                  <option value="photo">Фото</option>
                  <option value="signature">Подпись</option>
                </select>
                <label><input type="checkbox" checked={draft.mandatory} onChange={(e) => setDrafts((current) => ({ ...current, [checklist.id]: { ...draft, mandatory: e.target.checked } }))} /> Обязательное</label>
                <button className="btn btn-secondary" disabled={busy || !draft.label.trim()} onClick={() => addField(checklist.id)}>Добавить</button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};
