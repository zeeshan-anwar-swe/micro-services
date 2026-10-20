// Copy this module into a browser, mobile, or Node.js client with fetch support.
// The application owns token storage; getToken must return the current access token.
export function createTodoClient(baseUrl, getToken = () => null) {
  const base = baseUrl.replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, authenticated = true } = {}) {
    const token = authenticated ? await getToken() : null;
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 204) return null;
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error?.message ?? `HTTP ${response.status}`);
      error.status = response.status;
      error.code = result.error?.code;
      error.details = result.error?.details;
      throw error;
    }
    return result;
  }

  const page = ({ limit = 50, offset = 0 } = {}) => new URLSearchParams({ limit, offset }).toString();
  const id = encodeURIComponent;
  return {
    request,
    register: (body) => request('/auth/register', { method: 'POST', body, authenticated: false }),
    login: (body) => request('/auth/login', { method: 'POST', body, authenticated: false }),
    me: () => request('/auth/me'),
    todos: (pagination) => request(`/todos?${page(pagination)}`),
    todo: (todoId) => request(`/todos/${id(todoId)}`),
    createTodo: (body) => request('/todos', { method: 'POST', body }),
    updateTodo: (todoId, body) => request(`/todos/${id(todoId)}`, { method: 'PUT', body }),
    deleteTodo: (todoId) => request(`/todos/${id(todoId)}`, { method: 'DELETE' }),
    share: (body) => request('/shares', { method: 'POST', body }),
    sharedWithMe: (pagination) => request(`/shares/shared-with-me?${page(pagination)}`),
    history: (todoId, pagination) => request(`/chat/history/${id(todoId)}?${page(pagination)}`),
  };
}
