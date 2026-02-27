import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api/v1',
  timeout: 10000
});

export const fetchNotes = async ({ before, limit = 20, userId, chatWithId }) => {
  const params = { limit };
  if (before) params.before = before;
  if (userId) params.userId = userId;
  if (chatWithId) params.chatWithId = chatWithId;
  const res = await api.get('/notes', { params });
  return res.data;
};

export const createNote = async (payload) => {
  const res = await api.post('/notes', payload);
  return res.data;
};

export const deleteNoteAPI = async (id, userId, deleteType) => {
  const res = await api.delete(`/notes/${id}`, { params: { userId, deleteType } });
  return res.data;
};

export const deleteMultipleNotesAPI = async (ids, userId, deleteType) => {
  const res = await api.post('/notes/delete-multiple', { ids, userId, deleteType });
  return res.data;
};

export const editNoteAPI = async (id, payload) => {
  const res = await api.put(`/notes/${id}`, payload);
  return res.data;
};

export const pinNoteAPI = async (id) => {
  const res = await api.post(`/notes/pin/${id}`);
  return res.data;
};

export const unpinNoteAPI = async (id) => {
  const res = await api.post(`/notes/unpin/${id}`);
  return res.data;
};

export const fetchUnreadCountsAPI = async (userId) => {
  const res = await api.get(`/notes/unread-counts/${userId}`);
  return res.data;
};

export const markReadAPI = async (senderId, receiverId, isGroup = false) => {
  const res = await api.put('/notes/mark-read', { senderId, receiverId, isGroup });
  return res.data;
};

export const fetchConversationsAPI = async (userId) => {
  const res = await api.get(`/notes/conversations/${userId}`);
  return res.data;
};
