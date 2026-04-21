const { contextBridge, ipcRenderer } = require('electron')

function on(channel, listener) {
  const wrapped = (event, payload) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

contextBridge.exposeInMainWorld('bridge', {
  appInfo() {
    return ipcRenderer.invoke('app:info')
  },
  backendRequest(method, params = {}) {
    return ipcRenderer.invoke('backend:request', method, params)
  },
  consumePendingAuthUrl() {
    return ipcRenderer.invoke('auth:consumePendingUrl')
  },
  approveConnectRequest(request) {
    return ipcRenderer.invoke('auth:approveConnectRequest', request)
  },
  openExternalUrl(url) {
    return ipcRenderer.invoke('app:openExternalUrl', url)
  },
  onFacebonkAuthUrl(listener) {
    return on('facebonk:auth-url', listener)
  },
})
