let myDeviceId;
let localStream;
let peers = {};
let dataChannels = {};
let signalingSocket = null;
const AppState = {
  INITIAL: 'initial',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error'
};
let currentAppState = AppState.INITIAL;
let qrElement, statusElement, qrReaderElement, qrResultsElement, localVideoElement, remoteVideoElement, messageAreaElement, postAreaElement;
let messageInputElement, sendMessageButton, postInputElement, sendPostButton;
let fileInputElement, sendFileButton, fileTransferStatusElement;
let callButton, videoButton;
let startScanButton;
let remoteVideosContainer;
let incomingCallModal, callerIdElement, acceptCallButton, rejectCallButton;
let currentCallerId = null;
let friendListElement;
let pendingConnectionFriendId = null;
let receivedSize = {};
let incomingFileInfo = {};
let lastReceivedFileChunkMeta = {};
let onlineFriendsCache = new Set();
let autoConnectFriendsTimer = null;
const AUTO_CONNECT_INTERVAL = 2000;
let peerReconnectInfo = {};
let iceCandidateQueue = {};
const MAX_PEER_RECONNECT_ATTEMPTS = 3;
const INITIAL_PEER_RECONNECT_DELAY_MS = 2000;
let peerNegotiationTimers = {};
const NEGOTIATION_TIMEOUT_MS = 3000;
let wsReconnectAttempts = 0;
const MAX_WS_RECONNECT_ATTEMPTS = 10;
const INITIAL_WS_RECONNECT_DELAY_MS = 2000;
const MAX_WS_RECONNECT_DELAY_MS = 5000;
let wsReconnectTimer = null;
let isAttemptingReconnect = false;
const CHUNK_SIZE = 16384;
let fileReader;
const DB_NAME = 'cybernetcall-db';
const DB_VERSION = 3;
let dbPromise = typeof idb !== 'undefined' ? idb.openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    if (!db.objectStoreNames.contains('posts')) {
      db.createObjectStore('posts', { keyPath: 'id' });
    }
    if (oldVersion < 2 && !db.objectStoreNames.contains('friends')) {
      db.createObjectStore('friends', { keyPath: 'id' });
    }
    if (oldVersion < 3 && !db.objectStoreNames.contains('fileChunks')) {
      const store = db.createObjectStore('fileChunks', { keyPath: ['fileId', 'chunkIndex'] });
      store.createIndex('by_fileId', 'fileId');
    }
  }
}) : null;
if (!dbPromise) {
}
let statusMessages = [];
const MAX_STATUS_MESSAGES = 1000;

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}


function linkify(text) {
    if (!text) return '';


    const urlPattern = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
    text = text.replace(urlPattern, function(url) {
        let fullUrl = url;
        if (!url.match(/^https?:\/\//i) && url.startsWith('www.')) {
            fullUrl = 'http://' + url;
        }
        return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });

    const emailPattern = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
    text = text.replace(emailPattern, function(email) {
        return `<a href="mailto:${email}">${email}</a>`;
    });

    return text;
}

function renderStatusMessages() {
    if (!statusElement) return;
    statusElement.innerHTML = '';
    // statusMessages は unshift で追加しているので、そのままの順で表示すると新しいものが上に来る
    statusMessages.forEach(msgObj => {
        const div = document.createElement('div');
        div.textContent = msgObj.text;
        div.style.color = msgObj.color;
        statusElement.appendChild(div);
    });
    statusElement.style.display = statusMessages.length > 0 ? 'block' : 'none';
    // 必要であれば、常に一番下にスクロールする (新しいメッセージが下に追加される場合)
    // statusElement.scrollTop = statusElement.scrollHeight;
}

function updateStatus(message, color = 'black') {
    if (!statusElement) return;

    const messageText = String(message || '');

    // 明示的に空のメッセージが指定された場合は、全てのステータスをクリアする
    if (messageText === '') {
        statusMessages = [];
        renderStatusMessages();
        return;
    }
    const newMessage = {
        id: generateUUID(), // メッセージごとのユニークID
        text: messageText,
        color: color,
        timestamp: new Date() // タイムスタンプを追加
    };
    statusMessages.unshift(newMessage); // 新しいメッセージを配列の先頭に追加

    if (statusMessages.length > MAX_STATUS_MESSAGES) {
        statusMessages.length = MAX_STATUS_MESSAGES; // 配列の末尾 (古いメッセージ) から削除
    }
    renderStatusMessages();
}


function setInteractionUiEnabled(enabled) {
    const disabled = !enabled;
    if (messageInputElement) messageInputElement.disabled = disabled;
    if (sendMessageButton) sendMessageButton.disabled = disabled;
    if (postInputElement) postInputElement.disabled = disabled;
    if (sendPostButton) sendPostButton.disabled = disabled;
    if (fileInputElement) fileInputElement.disabled = disabled;
    if (sendFileButton) sendFileButton.disabled = disabled;
    if (callButton) callButton.disabled = disabled;
    if (videoButton) videoButton.disabled = disabled;

}
async function savePost(post) {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    const tx = db.transaction('posts', 'readwrite');
    await tx.store.put(post);
    await tx.done;
  } catch (error) {
  }
}
async function deletePostFromDb(postId) {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    const tx = db.transaction('posts', 'readwrite');
    await tx.store.delete(postId);
    await tx.done;
  } catch (error) {
  }
}
async function addFriend(friendId, friendName = null) {
  if (!dbPromise || !friendId) return;
  if (friendId === myDeviceId) {
      alert("You cannot add yourself as a friend.");
      return;
  }
  try {
    const db = await dbPromise;
    const tx = db.transaction('friends', 'readwrite');
    const existing = await tx.store.get(friendId);
    if (existing) {
        updateStatus(`Friend (${friendId.substring(0,6)}) is already added.`, 'orange');
        return;
    }
    await tx.store.put({ id: friendId, name: friendName, added: new Date() });
    await tx.done;
    updateStatus(`Friend (${friendId.substring(0,6)}) added successfully!`, 'green');
    await displayFriendList();
  } catch (error) {
    updateStatus("Failed to add friend.", 'red');
  }
}
async function isFriend(friendId, dbInstance = null) {
  if (!dbPromise || !friendId) return false;
  try {
    const db = dbInstance || await dbPromise;
    const friend = await db.get('friends', friendId);
    return !!friend;
  } catch (error) {
    return false;
  }
}
async function displayFriendList() {
  if (!dbPromise || !friendListElement) return;
  try {
    const db = await dbPromise;
    const friends = await db.getAll('friends');
    friendListElement.innerHTML = '<h3>Friends</h3>';
    if (friends.length === 0) {
        friendListElement.innerHTML += '<p>No friends added yet. Scan their QR code!</p>';
    }
    friends.forEach(friend => displaySingleFriend(friend));
  } catch (error) {
  }
}
async function displayInitialPosts() {
  if (!dbPromise || !postAreaElement) return;
  try {
    const db = await dbPromise;
    const posts = await db.getAll('posts');
    postAreaElement.innerHTML = '';
    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    posts.forEach(post => displayPost(post, false));
  } catch (error) {
  }
}
function displayPost(post, isNew = true) {
  if (!postAreaElement) return;
  const div = document.createElement('div');
  div.className = 'post';
  div.id = `post-${post.id}`;
  const contentSpan = document.createElement('span');
  const linkedContent = linkify(post.content);
  contentSpan.innerHTML = DOMPurify.sanitize(`<strong>${post.sender ? post.sender.substring(0, 6) : 'Unknown'}:</strong> ${linkedContent}`);
  const deleteButton = document.createElement('button');
  deleteButton.textContent = '❌';
  deleteButton.className = 'delete-post-button';
  deleteButton.dataset.postId = post.id;
  deleteButton.style.marginLeft = '10px';
  deleteButton.style.cursor = 'pointer';
  deleteButton.style.border = 'none';
  deleteButton.style.background = 'none';
  deleteButton.ariaLabel = 'Delete post';
  deleteButton.addEventListener('click', handleDeletePost);
  div.appendChild(contentSpan);
  div.appendChild(deleteButton);
  if (isNew && postAreaElement.firstChild) {
      postAreaElement.insertBefore(div, postAreaElement.firstChild);
  } else {
      postAreaElement.appendChild(div);
  }
}
async function handleDeletePost(event) {
    const button = event.currentTarget;
    const postId = button.dataset.postId;
    if (!postId) return;
    const postElement = document.getElementById(`post-${postId}`);
    if (postElement) {
        postElement.remove();
    }
    await deletePostFromDb(postId);
    const postDeleteMessage = JSON.stringify({
        type: 'delete-post',
        postId: postId
    });
    broadcastMessage(postDeleteMessage);
}
function displaySingleFriend(friend) {
    if (!friendListElement) return;
    const div = document.createElement('div');
    div.className = 'friend-item';
    div.dataset.friendId = friend.id;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = `ID: ${friend.id.substring(0, 8)}...`;
    const callFriendButton = document.createElement('button');
    callFriendButton.textContent = '📞 Call';
    callFriendButton.dataset.friendId = friend.id;
    callFriendButton.addEventListener('click', handleCallFriendClick);
    callFriendButton.disabled = !signalingSocket || signalingSocket.readyState !== WebSocket.OPEN || currentAppState === AppState.CONNECTING || currentAppState === AppState.CONNECTED;
    div.appendChild(nameSpan);
    div.appendChild(callFriendButton);
    friendListElement.appendChild(div);
}
async function connectWebSocket() {
  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    return;
  }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${location.host}/ws/signaling/`;
  updateStatus('Connecting to signaling server...', 'blue');
  signalingSocket = new WebSocket(wsUrl);
  signalingSocket.onopen = () => {
    wsReconnectAttempts = 0;
    isAttemptingReconnect = false;
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    updateStatus('Connected to signaling server. Registering...', 'blue');
    sendSignalingMessage({
      type: 'register',
      payload: { uuid: myDeviceId }
    });
  };
  signalingSocket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      const messageType = message.type;
      const payload = message.payload || {};
      const senderUUID = message.from || message.uuid || payload.uuid;
      switch (messageType) {
        case 'registered':
            updateStatus('Connected to signaling server. Ready.', 'green');
            currentAppState = AppState.INITIAL;
            setInteractionUiEnabled(false);
            await displayFriendList();
            if (pendingConnectionFriendId) {
                await createOfferForPeer(pendingConnectionFriendId);
                pendingConnectionFriendId = null;
            }
            break;
        case 'user_list':
            onlineFriendsCache.clear();
            if (dbPromise && message.users && Array.isArray(message.users)) {
                const db = await dbPromise;
                for (const userId of message.users) {
                    if (userId !== myDeviceId && await isFriend(userId, db)) {
                        onlineFriendsCache.add(userId);
                    }
                }
            }
            break;
        case 'user_joined':
        case 'user_online':
            const joinedUUID = message.uuid;
            if (joinedUUID && joinedUUID !== myDeviceId) {
                await displayFriendList();
                const friendExists = await isFriend(joinedUUID);
                if (friendExists) {
                    onlineFriendsCache.add(joinedUUID);
                    if (peers[joinedUUID]) {
                        if (peers[joinedUUID].connectionState === 'connecting') {
                          return;
                      }
                        const currentState = peers[joinedUUID].connectionState;
                        if (currentState === 'connected' || currentState === 'connecting') {
                        } else {
                            closePeerConnection(joinedUUID);
                            await createOfferForPeer(joinedUUID);
                        }
                    } else {
                        await createOfferForPeer(joinedUUID);
                    }
                } else {
                    updateStatus(`Peer ${joinedUUID.substring(0,6)} joined (NOT a friend).`, 'gray');
                }
            }
            break;
        case 'user_left':
            const leftUUID = message.uuid;
             if (leftUUID && leftUUID !== myDeviceId) {
                onlineFriendsCache.delete(leftUUID);
                updateStatus(`Peer ${leftUUID.substring(0,6)} left`, 'orange');
                closePeerConnection(leftUUID);
                await displayFriendList();
             }
            break;
        case 'offer':
            if (senderUUID) {;
                await handleOfferAndCreateAnswer(senderUUID, payload.sdp);
            }
            break;
        case 'answer':
             if (senderUUID) {
                console.log(`Received answer from ${senderUUID}`);
                await handleAnswer(senderUUID, payload.sdp);
            } else { console.warn("Answer received without sender UUID"); }
            break;
        case 'ice-candidate':
             if (senderUUID) {
                await handleIceCandidate(senderUUID, payload.candidate);
            }
            break;
        case 'call-request':
             if (senderUUID) {
                handleIncomingCall(senderUUID);
            }
            break;
        case 'call-accepted':
             if (senderUUID) {
                updateStatus(`Call accepted by ${senderUUID.substring(0,6)}. Connecting...`, 'blue');
                await createOfferForPeer(senderUUID);
            }
            break;
        case 'call-rejected':
             if (senderUUID) {
                handleCallRejected(senderUUID);
            }
            break;
        case 'call-busy':
             if (senderUUID) {
                handleCallBusy(senderUUID);
            }
            break;
      }
    } catch (error) {
    }
  };
  signalingSocket.onclose = async (event) => {
    const code = event.code;
    const reason = event.reason;
    console.log(`WebSocket disconnected: Code=${code}, Reason='${reason}', Current Attempts=${wsReconnectAttempts}`);
    const socketInstanceThatClosed = event.target;
    if (socketInstanceThatClosed) {
        socketInstanceThatClosed.onopen = null;
        socketInstanceThatClosed.onmessage = null;
        socketInstanceThatClosed.onerror = null;
        socketInstanceThatClosed.onclose = null;
    }
    if (signalingSocket !== socketInstanceThatClosed && signalingSocket !== null) {
        return;
    }
    signalingSocket = null;

    if ((code === 1000 || code === 1001) && !isAttemptingReconnect) {
        updateStatus('Signaling connection closed.', 'orange');
        resetConnection();
        await displayFriendList();
        return;
      }
      if (wsReconnectAttempts >= MAX_WS_RECONNECT_ATTEMPTS && isAttemptingReconnect) {
        updateStatus('Signaling connection lost. Please refresh the page.', 'red');
        resetConnection();
        await displayFriendList();
        isAttemptingReconnect = false;
        wsReconnectAttempts = 0;
        return;
      }
      if (!isAttemptingReconnect) {
        isAttemptingReconnect = true;
        wsReconnectAttempts = 0;
      }
      wsReconnectAttempts++;
      let delay = INITIAL_WS_RECONNECT_DELAY_MS * Math.pow(1.5, wsReconnectAttempts - 1);
      delay = Math.min(delay, MAX_WS_RECONNECT_DELAY_MS);
      updateStatus(`Signaling disconnected. Reconnecting in ${Math.round(delay/1000)}s (Attempt ${wsReconnectAttempts}/${MAX_WS_RECONNECT_ATTEMPTS})...`, 'orange');
      Object.keys(peers).forEach(peerUUID => closePeerConnection(peerUUID));
      Object.values(dataChannels).forEach(channel => { if (channel && channel.readyState !== 'closed') channel.close(); });
      dataChannels = {};
      setInteractionUiEnabled(false);
      currentAppState = AppState.CONNECTING;
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(async () => {
        await connectWebSocket();
      }, delay);
  };
  signalingSocket.onerror = (error) => {
    if (signalingSocket && (signalingSocket.readyState === WebSocket.OPEN || signalingSocket.readyState === WebSocket.CONNECTING)) {
        signalingSocket.close();
    } else if (!signalingSocket && !isAttemptingReconnect) {
    }
  };
}
function sendSignalingMessage(message) {
  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    if (!message.payload) message.payload = {};
    if (!message.payload.uuid) message.payload.uuid = myDeviceId;
    signalingSocket.send(JSON.stringify(message));
  } else {
    updateStatus('Signaling connection not ready.', 'red');
  }
}
function startAutoConnectFriendsTimer() {
  if (autoConnectFriendsTimer) {
      clearInterval(autoConnectFriendsTimer);
  }
  autoConnectFriendsTimer = setInterval(attemptAutoConnectToFriends, AUTO_CONNECT_INTERVAL);
  attemptAutoConnectToFriends();
}
function stopAutoConnectFriendsTimer() {
  if (autoConnectFriendsTimer) {
      clearInterval(autoConnectFriendsTimer);
      autoConnectFriendsTimer = null;
  }
}
async function attemptAutoConnectToFriends() {
  if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
      return;
  }
  if (currentAppState === AppState.CONNECTING && Object.keys(peers).some(id => peers[id]?.connectionState === 'connecting')) {
      return;
  }
  if (!dbPromise) {
      return;
  }
  try {
      const db = await dbPromise;
      const friends = await db.getAll('friends');
      if (friends.length === 0) return;
      for (const friend of friends) {
          if (friend.id === myDeviceId) continue;
          const isPeerConnectedOrConnecting = peers[friend.id] && (peers[friend.id].connectionState === 'connected' || peers[friend.id].connectionState === 'connecting' || peers[friend.id].connectionState === 'new');
          const isPeerUnderIndividualReconnect = peerReconnectInfo[friend.id] && peerReconnectInfo[friend.id].isReconnecting;
          if (onlineFriendsCache.has(friend.id) && !isPeerConnectedOrConnecting && !isPeerUnderIndividualReconnect) {
              updateStatus(`Auto-connecting to ${friend.id.substring(0,6)}...`, 'blue');
              await createOfferForPeer(friend.id, true);
          }
      }
  } catch (error) {
  }
}
async function startPeerReconnect(peerUUID) {
    if (!peers[peerUUID] || (peerReconnectInfo[peerUUID] && peerReconnectInfo[peerUUID].isReconnecting)) {
        return;
    }
    if (!await isFriend(peerUUID)) {
        closePeerConnection(peerUUID);
        return;
    }
    peerReconnectInfo[peerUUID] = {
        attempts: 0,
        timerId: null,
        isReconnecting: true
    };
    schedulePeerReconnectAttempt(peerUUID);
}
function schedulePeerReconnectAttempt(peerUUID) {
    const info = peerReconnectInfo[peerUUID];
    if (!info || !info.isReconnecting) {
        return;
    }
    info.attempts++;
    if (info.attempts > MAX_PEER_RECONNECT_ATTEMPTS) {
        updateStatus(`Failed to reconnect with ${peerUUID.substring(0,6)}.`, 'red');
        info.isReconnecting = false;
        closePeerConnection(peerUUID);
        return;
    }
    let delay = INITIAL_PEER_RECONNECT_DELAY_MS * Math.pow(1.5, info.attempts - 1);
    delay = Math.min(delay, 30000);
    updateStatus(`Reconnecting to ${peerUUID.substring(0,6)} (attempt ${info.attempts})...`, 'orange');
    if (info.timerId) clearTimeout(info.timerId);
    info.timerId = setTimeout(async () => {
        if (!info || !info.isReconnecting) return;
        if (peers[peerUUID] && peers[peerUUID].connectionState !== 'closed' && peers[peerUUID].connectionState !== 'failed') {
            closePeerConnection(peerUUID, true);
        }
        if (!peers[peerUUID]) {
            await createOfferForPeer(peerUUID, true);
        }
    }, delay);
}
function stopPeerReconnect(peerUUID) {
    const info = peerReconnectInfo[peerUUID];
    if (info) {
        if (info.timerId) clearTimeout(info.timerId);
        info.isReconnecting = false;
        delete peerReconnectInfo[peerUUID];
    }
}
function setNegotiationTimeout(peerUUID) {
    if (peerNegotiationTimers[peerUUID]) {
        clearTimeout(peerNegotiationTimers[peerUUID]);
    }
    peerNegotiationTimers[peerUUID] = setTimeout(async () => {
        if (peers[peerUUID] && peers[peerUUID].connectionState !== 'connected') {
            updateStatus(`Connection attempt with ${peerUUID.substring(0,6)} timed out. Retrying...`, 'orange');
            const isCurrentlyFriend = await isFriend(peerUUID);
            closePeerConnection(peerUUID, true);
            if (isCurrentlyFriend && signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
                 startPeerReconnect(peerUUID);
            } else {
            }
        }
        delete peerNegotiationTimers[peerUUID];
    }, NEGOTIATION_TIMEOUT_MS);
}
function clearNegotiationTimeout(peerUUID) {
    if (peerNegotiationTimers[peerUUID]) {
        clearTimeout(peerNegotiationTimers[peerUUID]);
        delete peerNegotiationTimers[peerUUID];
    }
}
async function createPeerConnection(peerUUID) {
  if (peers[peerUUID]) {
    console.warn(`Closing existing PeerConnection for ${peerUUID}.`);
    closePeerConnection(peerUUID, true);
  }
  clearNegotiationTimeout(peerUUID);
  iceCandidateQueue[peerUUID] = [];
  try {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    peer.onicecandidate = event => {
      if (event.candidate) {
        sendSignalingMessage({
            type: 'ice-candidate',
            payload: { target: peerUUID, candidate: event.candidate }
        });
      } else {
      }
    };
    peer.ondatachannel = event => {
      const channel = event.channel;
      channel.binaryType = 'arraybuffer';
      setupDataChannelEvents(peerUUID, channel);
    };
    peer.ontrack = (event) => {
      handleRemoteTrack(peerUUID, event.track, event.streams[0]);
    };
    peer.onconnectionstatechange = async () => {
      switch (peer.connectionState) {
        case 'connected':
          updateStatus(`Connected with ${peerUUID.substring(0,6)}!`, 'green');
          clearNegotiationTimeout(peerUUID);
          if (peerReconnectInfo[peerUUID] && peerReconnectInfo[peerUUID].isReconnecting) {
            stopPeerReconnect(peerUUID);
          }
          const connectedPeers = Object.values(peers).filter(p => p?.connectionState === 'connected');
          if (connectedPeers.length > 0 && (messageInputElement && !messageInputElement.disabled)) {
          } else if (connectedPeers.length > 0) {
              setInteractionUiEnabled(true);
              currentAppState = AppState.CONNECTED;
          }
          break;
        case 'disconnected':
        case 'failed':
          updateStatus(`Connection with ${peerUUID.substring(0,6)} ${peer.connectionState}`, 'orange');
          clearNegotiationTimeout(peerUUID);
          if (await isFriend(peerUUID) && (!peerReconnectInfo[peerUUID] || !peerReconnectInfo[peerUUID].isReconnecting)) {
            if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
                 startPeerReconnect(peerUUID);
            } else {
                 closePeerConnection(peerUUID);
            }
          }
          const stillConnectedPeers = Object.values(peers).filter(p => p?.connectionState === 'connected');
          if (stillConnectedPeers.length === 0 && currentAppState !== AppState.CONNECTING) {
              setInteractionUiEnabled(false); currentAppState = AppState.INITIAL; updateStatus('All peers disconnected.', 'orange');
          }
          break;
        case 'closed':
          updateStatus(`Connection with ${peerUUID.substring(0,6)} closed.`, 'orange');
          clearNegotiationTimeout(peerUUID);
          stopPeerReconnect(peerUUID);
          if (peers[peerUUID]) {
              closePeerConnection(peerUUID, true);
          }
          const stillConnectedPeersAfterClose = Object.values(peers).filter(p => p?.connectionState === 'connected');
          if (stillConnectedPeersAfterClose.length === 0 && currentAppState !== AppState.CONNECTING) {
              setInteractionUiEnabled(false);
              currentAppState = AppState.INITIAL;
              updateStatus('All peers disconnected or connections closed.', 'orange');
          }
          break;
        case 'connecting':
          updateStatus(`Connecting with ${peerUUID.substring(0,6)}...`, 'orange');
          break;
        default:
             updateStatus(`Connection state with ${peerUUID.substring(0,6)}: ${peer.connectionState}`, 'orange');
      }
    };
    peers[peerUUID] = peer;
    return peer;
  } catch (error) {
    updateStatus(`Connection setup error: ${error.message}`, 'red');
    currentAppState = AppState.ERROR;
    return null;
  }
}
function setupDataChannelEvents(peerUUID, channel) {
    if (!channel) return;
    dataChannels[peerUUID] = channel;
    channel.onmessage = (event) => handleDataChannelMessage(event, peerUUID);
    channel.onopen = () => {
        const openPeers = Object.entries(dataChannels)
                                .filter(([uuid, dc]) => dc && dc.readyState === 'open')
                                .map(([uuid, dc]) => uuid.substring(0,6));
        if (openPeers.length > 0) {
            setInteractionUiEnabled(true);
            currentAppState = AppState.CONNECTED;
            updateStatus(`Ready to chat/send files with: ${openPeers.join(', ')}!`, 'green');
        } else {
            setInteractionUiEnabled(false);
        }
    };
    channel.onclose = () => {
        delete dataChannels[peerUUID];
        const openPeers = Object.entries(dataChannels)
                                .filter(([uuid, dc]) => dc && dc.readyState === 'open')
                                .map(([uuid, dc]) => uuid.substring(0,6));
        if (openPeers.length === 0) {
            updateStatus(`Data channel with ${peerUUID.substring(0,6)} closed. No active data channels.`, 'orange');
            setInteractionUiEnabled(false);
        } else {
            updateStatus(`Data channel with ${peerUUID.substring(0,6)} closed. Still ready with: ${openPeers.join(', ')}!`, 'orange');
        }
    };
    channel.onerror = (error) => {
        updateStatus(`Data channel error: ${error}`, 'red');
        closePeerConnection(peerUUID);
    };
}
async function createOfferForPeer(peerUUID, isReconnectAttempt = false) {
    currentAppState = AppState.CONNECTING;
    const peer = await createPeerConnection(peerUUID);
    if (!peer) return;
    const offerSdp = await createOfferAndSetLocal(peerUUID);
    if (offerSdp) {
        sendSignalingMessage({
            type: 'offer',
            payload: { target: peerUUID, sdp: offerSdp }
        });
        setNegotiationTimeout(peerUUID);
    } else {
        closePeerConnection(peerUUID);
    }
}
async function createOfferAndSetLocal(peerUUID) {
  const peer = peers[peerUUID];
  if (!peer) {
      return null;
  }
  try {
    const channel = peer.createDataChannel('cybernetcall-data');
    channel.binaryType = 'arraybuffer';
    setupDataChannelEvents(peerUUID, channel);
    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                peer.addTrack(track, localStream);
            } catch (e) { }
        });
    }
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    return peer.localDescription;
  } catch (error) {
    updateStatus(`Offer creation error for ${peerUUID}: ${error.message}`, 'red');
    return null;
  }
}
async function handleOfferAndCreateAnswer(peerUUID, offerSdp) {
  let peer = peers[peerUUID];
  const isRenegotiation = !!peer;
  if (!isRenegotiation) {
    iceCandidateQueue[peerUUID] = [];
    peer = await createPeerConnection(peerUUID);
    if (!peer) {
        return;
    }
    const alreadyFriend = await isFriend(peerUUID);
    if (!alreadyFriend) {
        await addFriend(peerUUID);
    }
  }
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(offerSdp));
    await processIceCandidateQueue(peerUUID);
    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                const senderExists = peer.getSenders().find(s => s.track === track);
                if (!senderExists) {
                    peer.addTrack(track, localStream);
                }
            } catch (e) { }
        });
    }
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    sendSignalingMessage({
        type: 'answer',
        payload: { target: peerUUID, sdp: peer.localDescription }
    });
    setNegotiationTimeout(peerUUID);
  } catch (error) {
    updateStatus(`Offer handling / Answer creation error for ${peerUUID}: ${error.message}`, 'red');
    closePeerConnection(peerUUID);
  }
}
async function handleAnswer(peerUUID, answerSdp) {
  const peer = peers[peerUUID];
  if (!peer) {
       return null;
  }
  const isRenegotiationAnswer = peer.signalingState === 'have-local-offer';
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(answerSdp));
    await processIceCandidateQueue(peerUUID);
    return true;
  } catch (error) {
    updateStatus(`Answer handling error for ${peerUUID}: ${error.message}`, 'red');
    return false;
  }
}
async function handleIceCandidate(peerUUID, candidateData) {
    try {
        const peer = peers[peerUUID];
        if (!peer) {
            if (!iceCandidateQueue[peerUUID]) {
                iceCandidateQueue[peerUUID] = [];
            }
            iceCandidateQueue[peerUUID].push(candidateData);
            return;
        }
        if (candidateData) {
            if (peer.remoteDescription) {
                await peer.addIceCandidate(new RTCIceCandidate(candidateData));
            } else {
                if (!iceCandidateQueue[peerUUID]) {
                    iceCandidateQueue[peerUUID] = [];
                }
                iceCandidateQueue[peerUUID].push(candidateData);
            }
        }
    } catch (error) {
    }
}
async function processIceCandidateQueue(peerUUID) {
    const peer = peers[peerUUID];
    if (peer && peer.remoteDescription && iceCandidateQueue[peerUUID]) {
        while (iceCandidateQueue[peerUUID].length > 0) {
            const candidate = iceCandidateQueue[peerUUID].shift();
            try {
                await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
            }
        }
    }
}
function resetConnection() {
    try {
        if (typeof Html5QrcodeScannerState !== 'undefined' && window.html5QrCodeScanner && window.html5QrCodeScanner.getState() === Html5QrcodeScannerState.SCANNING) {
            window.html5QrCodeScanner.stop().catch(e => console.warn("Error stopping scanner during reset:", e));
        } else if (window.html5QrCodeScanner) {
            window.html5QrCodeScanner.clear().catch(e => console.warn("Error clearing scanner during reset:", e));
        }
    } catch(e) { console.warn("Error accessing scanner state during reset:", e); }
    if (signalingSocket) {
        signalingSocket.onclose = null;
        signalingSocket.onerror = null;
        signalingSocket.onmessage = null;
        signalingSocket.onopen = null;
        if (signalingSocket.readyState === WebSocket.OPEN || signalingSocket.readyState === WebSocket.CONNECTING) {
            signalingSocket.close(1000);
        }
        signalingSocket = null;
    }
    Object.values(dataChannels).forEach(channel => {
        if (channel) {
            channel.onmessage = null;
            channel.onopen = null;
            channel.onclose = null;
            channel.onerror = null;
            if (channel.readyState !== 'closed') {
                channel.close();
            }
        }
    });
    dataChannels = {};
    Object.keys(peers).forEach(peerUUID => closePeerConnection(peerUUID, true));
    peers = {};
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        if(localVideoElement) localVideoElement.srcObject = null;
        if(callButton) callButton.textContent = '📞';
        if(videoButton) videoButton.textContent = '🎥';
    }
    if (remoteVideosContainer) {
        remoteVideosContainer.innerHTML = '';
    } else if (remoteVideoElement) {
        remoteVideoElement.srcObject = null;
    }
    currentAppState = AppState.INITIAL;
    receivedSize = {};
    incomingFileInfo = {};
    if (fileTransferStatusElement) fileTransferStatusElement.textContent = '';
    currentCallerId = null;
    if (incomingCallModal) incomingCallModal.style.display = 'none';
    if(qrReaderElement) qrReaderElement.style.display = 'none';
    if(startScanButton) startScanButton.disabled = false;
    updateStatus('Ready. Add friends or wait for connection.', 'black');
    setInteractionUiEnabled(false);
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
    isAttemptingReconnect = false;
    if(messageAreaElement) messageAreaElement.innerHTML = '';
    if(postAreaElement) postAreaElement.innerHTML = '';
}
function closePeerConnection(peerUUID, silent = false) {
    clearNegotiationTimeout(peerUUID);
    stopPeerReconnect(peerUUID);
    const peer = peers[peerUUID];
    if (peer) {
        peer.onicecandidate = null;
        peer.ondatachannel = null;
        peer.ontrack = null;
        const tempOnConnectionStateChange = peer.onconnectionstatechange;
        peer.onconnectionstatechange = null;
        if (peer.signalingState !== 'closed') {
            peer.close();
        }
        delete peers[peerUUID];
        delete iceCandidateQueue[peerUUID];
    }
    const channel = dataChannels[peerUUID];
    if (channel) {
        if (channel.readyState !== 'closed') {
            channel.close();
        }
        delete dataChannels[peerUUID];
    }
    const videoElement = document.getElementById(`remoteVideo-${peerUUID}`);
    if (videoElement) {
        videoElement.remove();
    }
    if (!silent) {
        const connectedPeersCount = Object.values(peers).filter(p => p?.connectionState === 'connected').length;
        if (connectedPeersCount === 0 && currentAppState !== AppState.CONNECTING) {
             setInteractionUiEnabled(false);
             currentAppState = AppState.INITIAL;
             updateStatus(`Connection with ${peerUUID.substring(0,6)} closed. No active connections.`, 'orange');
        } else if (connectedPeersCount > 0) {
            updateStatus(`Connection with ${peerUUID.substring(0,6)} closed. Still connected to others.`, 'orange');
        }
    }
}
function handleDataChannelMessage(event, senderUUID) {
  if (event.data instanceof ArrayBuffer) {
    if (lastReceivedFileChunkMeta[senderUUID]) {
        const meta = lastReceivedFileChunkMeta[senderUUID];
        processFileChunk(meta, event.data);
        lastReceivedFileChunkMeta[senderUUID] = null;
    }
  } else if (typeof event.data === 'string') {
    processTextMessage(event.data, senderUUID);
  } else {
  }
}
async function processTextMessage(dataString, senderUUID) {
    try {
        const message = JSON.parse(dataString);
        switch (message.type) {
            case 'post':
                message.sender = message.sender || senderUUID;
                await savePost(message);
                displayPost(message, true);
                break;
            case 'direct-message':
                message.sender = message.sender || senderUUID;
                displayDirectMessage(message, false, senderUUID);
                break;
            case 'delete-post':
                const postElement = document.getElementById(`post-${message.postId}`);
                if (postElement) {
                    postElement.remove();
                }
                await deletePostFromDb(message.postId);
                break;
            case 'file-metadata':
                incomingFileInfo[message.fileId] = {
                    name: message.name,
                    size: message.size,
                    type: message.fileType
                };
                receivedSize[message.fileId] = 0;
                if (fileTransferStatusElement) {
                    fileTransferStatusElement.textContent = `Receiving ${message.name}... 0%`;
                }
                break;
            case 'file-chunk':
                lastReceivedFileChunkMeta[senderUUID] = { ...message, senderUUID };
                break;
            default:
                if (!message.type && message.content && message.id) {
                     await savePost(message);
                     displayPost(message, true);
                }
        }
    } catch (error) {
    }
}
async function processFileChunk(chunkMeta, chunkDataAsArrayBuffer) {
    const { fileId, index: chunkIndex, last: isLast, senderUUID } = chunkMeta;
    if (!incomingFileInfo[fileId]) {
      console.error(`Received chunk data for unknown file transfer (no metadata): ${fileId} from ${senderUUID}`);
        return;
    }
    let db;
    try {
        if (!(chunkDataAsArrayBuffer instanceof ArrayBuffer)) {
            await cleanupFileTransferData(fileId, null);
            return;
        }
        if (!dbPromise) {
            if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize(`DB Error for ${incomingFileInfo[fileId]?.name || 'file'}`);
            delete incomingFileInfo[fileId];
            if (receivedSize) delete receivedSize[fileId];
            return;
        }
        db = await dbPromise;
        const tx = db.transaction('fileChunks', 'readwrite');
        await tx.store.put({ fileId: fileId, chunkIndex: chunkIndex, data: chunkDataAsArrayBuffer });
        await tx.done;
        const readTxForSize = db.transaction('fileChunks', 'readonly');
        const allChunksForFileFromDb = await readTxForSize.objectStore('fileChunks').index('by_fileId').getAll(fileId);
        await readTxForSize.done;
        let actualReceivedSize = 0;
        allChunksForFileFromDb.forEach(c => actualReceivedSize += c.data.byteLength);
        receivedSize[fileId] = actualReceivedSize;
        const progress = Math.round((receivedSize[fileId] / incomingFileInfo[fileId].size) * 100);
        if (fileTransferStatusElement) {
          fileTransferStatusElement.innerHTML = DOMPurify.sanitize(`Receiving ${incomingFileInfo[fileId].name}... ${progress}%`);
        }
        if (isLast) {
            if (receivedSize[fileId] !== incomingFileInfo[fileId].size) {
                if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize(`Error assembling ${incomingFileInfo[fileId].name} (final size error)`);
                await cleanupFileTransferData(fileId, db);
                return;
            }
            allChunksForFileFromDb.sort((a, b) => a.chunkIndex - b.chunkIndex);
            if (allChunksForFileFromDb.length !== chunkIndex + 1) {
                 console.warn(`Missing chunks for file ${fileId}. Expected ${chunkIndex + 1}, got ${allChunksForFileFromDb.length} from DB. Cannot assemble.`);
                 if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize(`Error receiving ${incomingFileInfo[fileId].name} (missing chunks from DB)`);
                 await cleanupFileTransferData(fileId, db);
                 return;
            }
            const orderedChunkData = allChunksForFileFromDb.map(c => c.data);
            const fileBlob = new Blob(orderedChunkData, { type: incomingFileInfo[fileId].type });
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(fileBlob);
            downloadLink.download = incomingFileInfo[fileId].name;
            downloadLink.textContent = `Download ${incomingFileInfo[fileId].name}`;
            downloadLink.style.display = 'block';
            downloadLink.style.marginTop = '5px';
            if (fileTransferStatusElement) {
              fileTransferStatusElement.innerHTML = '';
                fileTransferStatusElement.appendChild(downloadLink);
            } else {
                messageAreaElement.appendChild(downloadLink);
            }
            await cleanupFileTransferData(fileId, db, true);
        }
    } catch (error) {
    if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize(`Error processing chunk for ${incomingFileInfo[fileId]?.name || 'unknown file'}`);
    await cleanupFileTransferData(fileId, db);
  }
}
function broadcastMessage(messageString) {
    let sentToAtLeastOne = false;
    const openChannels = Object.entries(dataChannels).filter(([uuid, dc]) => dc && dc.readyState === 'open');
    if (openChannels.length > 0) {
        openChannels.forEach(([uuid, dc]) => {
            try {
                dc.send(messageString);
                sentToAtLeastOne = true;
            } catch (error) {
                console.error(`Error sending message to ${uuid}:`, error);
            }
        });
    } else {
        console.warn("Cannot broadcast message: No open DataChannels.");
    }
    return sentToAtLeastOne;
}
async function cleanupFileTransferData(fileId, db, transferComplete = false) {
    if (db) {
        try {
            const deleteTx = db.transaction('fileChunks', 'readwrite');
            const allChunksForFile = await deleteTx.objectStore('fileChunks').index('by_fileId').getAllKeys(fileId);
            for (const key of allChunksForFile) {
                 await deleteTx.objectStore('fileChunks').delete(key);
            }
            await deleteTx.done;
        } catch (dbError) {
            console.error(`[File Chunk DB] Error deleting chunks for file ${fileId}:`, dbError);
        }
    }
    delete incomingFileInfo[fileId];
    if (receivedSize) delete receivedSize[fileId];
}
function broadcastBinaryData(dataBuffer) {
    const openChannels = Object.entries(dataChannels).filter(([uuid, dc]) => dc && dc.readyState === 'open');
    if (openChannels.length > 0) {
        openChannels.forEach(([uuid, dc]) => {
            try {
                dc.send(dataBuffer);
            } catch (error) {
                console.error(`Error sending binary data to ${uuid}:`, error);
            }
        });
        return true;
    } else {
        console.warn("Cannot broadcast binary data: No open DataChannels.");
        return false;
    }
}
function handleSendMessage() {
    const input = messageInputElement;
    const content = input?.value?.trim();
    if (content) {
        const message = {
            type: 'direct-message',
            content: content,
            sender: myDeviceId,
            timestamp: new Date().toISOString()
        };
        const messageString = JSON.stringify(message);
        if (broadcastMessage(messageString)) {
            displayDirectMessage(message, true);
            if(input) input.value = '';
        } else {
            alert(`Not connected to any peers. Please wait or rejoin.`);
        }
    }
}
function displayDirectMessage(message, isOwnMessage = false, senderUUID = null) {
    if (!messageAreaElement) return;
    const div = document.createElement('div');
    div.classList.add('message', isOwnMessage ? 'own-message' : 'peer-message');
    let senderName = 'Unknown';
    if (isOwnMessage) {
        senderName = 'You';
    } else if (senderUUID) {
        senderName = `Peer (${senderUUID.substring(0, 6)})`;
    } else if (message.sender) {
        senderName = `Peer (${message.sender.substring(0, 6)})`;
    }
    const linkedContent = linkify(message.content);
    div.innerHTML = DOMPurify.sanitize(`<strong>${senderName}:</strong> ${linkedContent}`);
    messageAreaElement.appendChild(div);
    messageAreaElement.scrollTop = messageAreaElement.scrollHeight;
}
async function handleSendPost() {
  const input = postInputElement;
  const content = input?.value?.trim();
  if (content) {
    const post = {
      type: 'post',
      id: generateUUID(),
      content: content,
      sender: myDeviceId,
      timestamp: new Date().toISOString()
    };
    await savePost(post);
    displayPost(post, true);
    const postString = JSON.stringify(post);
    if (!broadcastMessage(postString)) {
        alert("Not connected. Post saved locally only.");
    }
    if(input) input.value = '';
  }
}
function handleSendFile() {
    if (!fileInputElement || !fileInputElement.files || fileInputElement.files.length === 0) {
        alert("Please select a file.");
        return;
    }
    const openChannels = Object.entries(dataChannels).filter(([uuid, dc]) => dc && dc.readyState === 'open');
    if (openChannels.length === 0) {
        console.warn("Send file clicked but no open data channels.");
        alert("Not connected to any peers to send the file.");
        return;
    }
    const file = fileInputElement.files[0];
    const snapshottedFileSize = file.size;
    const fileId = generateUUID();
    if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize(`Sending ${file.name}... 0%`);
    sendFileButton.disabled = true;
    const metadata = {
        type: 'file-metadata',
        fileId: fileId,
        name: file.name,
        size: snapshottedFileSize,
        fileType: file.type
    };
    const metadataString = JSON.stringify(metadata);
    if (!broadcastMessage(metadataString)) {
        alert("Failed to send file metadata to any peer.");
        sendFileButton.disabled = false;
        return;
    }
    fileReader = new FileReader();
    let offset = 0;
    let chunkIndex = 0;
    fileReader.addEventListener('error', error => {
        console.error('FileReader error:', error);
        alert('File read error occurred.');
        if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize('File read error');
        sendFileButton.disabled = false;
    });
    fileReader.addEventListener('abort', event => {
        console.log('FileReader abort:', event);
        if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize('File send aborted');
        sendFileButton.disabled = false;
    });
    fileReader.addEventListener('load', e => {
        const chunkArrayBuffer = e.target.result;
        if (openChannels.length > 0) {
            const firstChannel = openChannels[0][1];
            const bufferedAmount = firstChannel.bufferedAmount || 0;
            if (bufferedAmount > CHUNK_SIZE * 16) {
                setTimeout(() => {
                    sendFileChunk(chunkArrayBuffer, file.name, snapshottedFileSize, fileId, chunkIndex, offset);
                }, 200);
                return;
            }
        } else {
            console.warn("No open channels to send file chunk.");
            if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize('Connection lost during send');
            sendFileButton.disabled = false;
            return;
        }
        sendFileChunk(chunkArrayBuffer, file.name, snapshottedFileSize, fileId, chunkIndex, offset);
    });
    const readSlice = o => {
        try {
            const end = Math.min(o + CHUNK_SIZE, snapshottedFileSize);
            const slice = file.slice(o, end);
            fileReader.readAsArrayBuffer(slice);
        } catch (readError) {
             console.error('Error reading file slice:', readError);
             alert('Failed to read file slice.');
             if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'File slice error';
             sendFileButton.disabled = false;
        }
    };
    const sendFileChunk = async (chunkDataAsArrayBuffer, originalFileName, originalFileSizeInLogic, currentFileId, currentChunkIndex, currentOffset, retryCount = 0) => {
         try {
            const chunkMetaMessage = {
                 type: 'file-chunk',
                 fileId: currentFileId,
                 index: currentChunkIndex,
                 last: ((currentOffset + chunkDataAsArrayBuffer.byteLength) >= originalFileSizeInLogic)
             };
             const metaString = JSON.stringify(chunkMetaMessage);
             if (!broadcastMessage(metaString)) {
                 if (retryCount < 3) throw new Error(`Failed to send chunk meta ${currentChunkIndex} to any peer.`);
                 else {
                    console.error(`Failed to send chunk meta ${currentChunkIndex} after multiple retries.`);
                 }
             }
             setTimeout(() => {
                if (!broadcastBinaryData(chunkDataAsArrayBuffer)) {
                    if (retryCount < 3) throw new Error(`Failed to send chunk data ${currentChunkIndex} to any peer.`);
                 else {
                    console.error(`Failed to send chunk data ${currentChunkIndex} after multiple retries.`);
                 }
             }
             const newOffset = currentOffset + chunkDataAsArrayBuffer.byteLength;
             const progress = Math.round((newOffset / originalFileSizeInLogic) * 100);
             if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Sending ${originalFileName}... ${progress}%`;
             if (newOffset < originalFileSizeInLogic) {
                offset = newOffset;
                 chunkIndex++;
                 setTimeout(() => readSlice(newOffset), 0);
             } else {
                 if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize(`Sent ${originalFileName}`);
                 if(fileInputElement) fileInputElement.value = '';
                 sendFileButton.disabled = false;
             }
            }, 10);
        } catch (error) {
             console.error(`Error sending chunk ${currentChunkIndex}:`, error);
             if (retryCount < 3) {
                 setTimeout(() => sendFileChunk(chunkDataAsArrayBuffer, originalFileName, originalFileSizeInLogic, currentFileId, currentChunkIndex, currentOffset, retryCount + 1), 1000 * (retryCount + 1));
             } else {
                 alert(`Failed to send chunk ${currentChunkIndex} after multiple retries.`);
                 if (fileTransferStatusElement) fileTransferStatusElement.innerHTML = DOMPurify.sanitize('Chunk send error');
                 await cleanupFileTransferData(currentFileId, await dbPromise);
                 sendFileButton.disabled = false;
             }
         }
    }
    readSlice(0);
}
async function toggleVideoCall() {
  if (currentAppState !== AppState.CONNECTED && currentAppState !== AppState.CONNECTING && !Object.values(peers).some(p => p && p.connectionState === 'connected')) {
        console.warn("Call button clicked but not connected.");
        alert("Please connect to a peer first.");
        return;
    }
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = false;
            }
            if (localVideoElement) localVideoElement.srcObject = localStream;
            const renegotiationPromises = Object.entries(peers).map(async ([peerUUID, peer]) => {
                if (peer) {
                    localStream.getTracks().forEach(track => {
                        try {
                            if (peer.addTrack) {
                                const sender = peer.addTrack(track, localStream);
                            } else { console.warn(`peer.addTrack is not supported for ${peerUUID}.`); }
                        } catch (e) { console.error(`Error adding track to ${peerUUID}:`, e); }
                    });
                    await createAndSendOfferForRenegotiation(peerUUID, peer);
                }
            });
            await Promise.all(renegotiationPromises);
            if(videoButton) videoButton.textContent = '🚫';
            if(callButton) callButton.textContent = 'End Call';
        } catch (error) {
            alert(`Media access error: ${error.message}`);
            localStream = null;
        }
    } else {
        localStream.getTracks().forEach(track => track.stop());
        const tracksToRemove = localStream.getTracks();
        localStream = null;
        const renegotiationPromises = Object.entries(peers).map(async ([peerUUID, peer]) => {
            if (peer) {
                peer.getSenders().forEach(sender => {
                    if (sender && sender.track && tracksToRemove.includes(sender.track)) {
                        try {
                            if (peer.removeTrack) {
                                peer.removeTrack(sender);
                            } else { console.warn(`peer.removeTrack is not supported for ${peerUUID}.`); }
                        } catch (e) { console.error(`Error removing track from ${peerUUID}:`, e); }
                    }
                });
                await createAndSendOfferForRenegotiation(peerUUID, peer);
            }
        });
        await Promise.all(renegotiationPromises);
        if(localVideoElement) localVideoElement.srcObject = null;
        if(callButton) callButton.textContent = '📞';
        if(videoButton) videoButton.textContent = '🎥';
    }
}
async function createAndSendOfferForRenegotiation(peerUUID, peer) {
    if (!peer || peer.connectionState !== 'connected') {
        console.warn(`Cannot renegotiate with ${peerUUID}, connection not established.`);
        return;
    }
    try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendSignalingMessage({
            type: 'offer',
            payload: { target: peerUUID, sdp: peer.localDescription }
        });
        setNegotiationTimeout(peerUUID);
    } catch (error) {
        console.error(`Error during renegotiation offer for ${peerUUID}:`, error);
    }
}
function toggleLocalVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            if(videoButton) videoButton.textContent = videoTrack.enabled ? '🎥' : '🚫';
        }
      } else {
      }
}
function handleRemoteTrack(peerUUID, track, stream) {
    if (!remoteVideosContainer) {
        console.warn("Remote videos container not found.");
        return;
    }
    let videoElement = document.getElementById(`remoteVideo-${peerUUID}`);
    if (!videoElement) {
        console.log(`Creating video element for ${peerUUID}`);
        videoElement = document.createElement('video');
        videoElement.id = `remoteVideo-${peerUUID}`;
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        remoteVideosContainer.appendChild(videoElement);
    }
    if (!videoElement.srcObject && stream) {
        videoElement.srcObject = stream;
    } else if (videoElement.srcObject) {
        if (!videoElement.srcObject.getTrackById(track.id)) {
            videoElement.srcObject.addTrack(track);
        }
    } else {
        console.warn(`Could not set srcObject for ${peerUUID} - no stream provided?`);
    }
}
function updateQrCodeWithValue(value) {
    if (!qrElement) {
        console.warn("QR element not available for update.");
        return;
    }
    if (!value || typeof value !== 'string' || !value.includes('?id=')) {
        console.warn("Invalid or no value provided to update QR code. Value:", value);
        if (qrElement) {
            qrElement.innerHTML = DOMPurify.sanitize("Your ID is not ready yet or invalid. Please wait or refresh.");
            qrElement.style.display = 'block';
        }
        return;
    }
    const size = Math.min(window.innerWidth * 0.7, 250);
    if (typeof QRious !== 'undefined') {
        try {
          new QRious({ element: qrElement, value: value, size: size, level: 'L' });
        } catch (e) {
             console.error("QRious error:", e);
             qrElement.innerHTML = DOMPurify.sanitize("QR Code Generation Error");
        }
    } else {
        console.error("QRious not loaded.");
        setTimeout(() => updateQrCodeWithValue(value), 500);
    }
}
function handleStartScanClick() {
    if (!window.html5QrCodeScanner || window.html5QrCodeScanner.getState() !== 2 ) {
        startQrScanner();
    } else {
        console.warn("Scan button clicked but already scanning or scanner not ready.");
    }
}
function startQrScanner() {
    if (window.html5QrCodeScanner && window.html5QrCodeScanner.getState() === 2 ) {
        return;
    }
    if (!qrReaderElement) {
        console.warn("QR Reader element not available for start.");
        return;
    }
    if(startScanButton) startScanButton.disabled = true;
    qrReaderElement.style.display = 'block';
    if (typeof Html5Qrcode !== 'undefined') {
        try {
            if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.getState === 'function') {
                 const state = window.html5QrCodeScanner.getState();
                 if (state === 2 || state === 1 ) {
                     window.html5QrCodeScanner.stop().catch(e => console.warn("Ignoring error stopping previous scanner:", e));
                 }
            } else if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.clear === 'function') {
                window.html5QrCodeScanner.clear().catch(e => console.warn("Ignoring error clearing previous scanner:", e));
            }
        } catch (e) { console.warn("Error accessing previous scanner state:", e); }
        try {
            window.html5QrCodeScanner = new Html5Qrcode("qr-reader");
        } catch (e) {
            console.error("Error creating Html5Qrcode instance:", e);
            updateStatus(`QR Reader initialization error: ${e.message}`, 'red');
            if(qrReaderElement) qrReaderElement.style.display = 'none';
            if(startScanButton) startScanButton.disabled = false;
            return;
        }
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            updateStatus('QR Scan successful. Processing...', 'blue');
            window.html5QrCodeScanner.stop().then(ignore => {
                if(qrReaderElement) qrReaderElement.style.display = 'none';
                 handleScannedQrData(decodedText);
            }).catch(err => {
                 if(qrReaderElement) qrReaderElement.style.display = 'none';
                 handleScannedQrData(decodedText);
            }).finally(() => {
                 if(startScanButton) startScanButton.disabled = false;
            });
        };
        const config = { fps: 10, qrbox: { width: 200, height: 200 } };
        window.html5QrCodeScanner.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
            .catch(err => {
                console.error(`QR Scanner start error: ${err}`);
                if (err.name === 'NotAllowedError') {
                    updateStatus('Camera access denied. Please check settings.', 'red');
                } else {
                    updateStatus(`QR scanner error: ${err.message}`, 'red');
                }
                if(qrReaderElement) qrReaderElement.style.display = 'none';
                if(startScanButton) startScanButton.disabled = false;
            });
    } else {
        console.error("Html5Qrcode not loaded.");
        if(qrReaderElement) qrReaderElement.style.display = 'none';
        if(startScanButton) startScanButton.disabled = false;
        setTimeout(startQrScanner, 500);
    }
}
async function handleScannedQrData(decodedText) {
    if(startScanButton) startScanButton.disabled = false;
    try {
        const url = new URL(decodedText);
        const params = new URLSearchParams(url.search);
        const friendId = params.get('id');
        if (friendId) {
            await addFriend(friendId);
            if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
                updateStatus(`Connecting to ${friendId.substring(0,6)}...`, 'blue');
                await createOfferForPeer(friendId);
            } else { console.warn("WebSocket not ready, cannot initiate connection automatically after scan."); }
        } else {
            const msg = "Invalid QR code: URL does not contain an 'id' parameter.";
            updateStatus(msg, 'red');
        }
    } catch (error) {
        console.error("Error handling scanned data:", error);
        if (error instanceof TypeError && error.message.includes("Invalid URL")) {
             updateStatus('Invalid QR code: Not a valid URL format.', 'red');
        } else {
             updateStatus(`QR data processing error: ${error.message}`, 'red');
             alert(`QR data processing error: ${error.message}`);
        }
    }
}
function handleCallFriendClick(event) {
    const friendId = event.target.dataset.friendId;
    if (!friendId) return;
    if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
        alert("Not connected to signaling server. Please wait or refresh.");
        return;
    }
    if (currentAppState === AppState.CONNECTING || currentAppState === AppState.CONNECTED) {
        alert("Already in a call or connecting.");
        return;
    }
    updateStatus(`Calling ${friendId.substring(0, 6)}...`, 'blue');
    setInteractionUiEnabled(false);
    displayFriendList();
    sendSignalingMessage({
        type: 'call-request',
        payload: { target: friendId }
    });
}
function handleIncomingCall(callerId) {
    if (currentAppState === AppState.CONNECTING || currentAppState === AppState.CONNECTED) {
        sendSignalingMessage({ type: 'call-busy', payload: { target: callerId } });
        return;
    }
    currentCallerId = callerId;
    if (callerIdElement) callerIdElement.textContent = callerId.substring(0, 8) + '...';
    if (incomingCallModal) incomingCallModal.style.display = 'block';
}
async function handleAcceptCall() {
    if (!currentCallerId) return;
    if (incomingCallModal) incomingCallModal.style.display = 'none';
    updateStatus(`Accepting call from ${currentCallerId.substring(0,6)}. Connecting...`, 'blue');
    sendSignalingMessage({ type: 'call-accepted', payload: { target: currentCallerId } });
    await createPeerConnection(currentCallerId);
    currentAppState = AppState.CONNECTING;
}
function handleRejectCall() {
    if (!currentCallerId) return;
    if (incomingCallModal) incomingCallModal.style.display = 'none';
    sendSignalingMessage({ type: 'call-rejected', payload: { target: currentCallerId } });
    currentCallerId = null;
}
async function handleCallRejected(peerId) {
    updateStatus(`Call rejected by ${peerId.substring(0, 6)}.`, 'orange');
    currentAppState = AppState.INITIAL;
    setInteractionUiEnabled(false);
    await displayFriendList();
}
async function handleCallBusy(peerId) {
    updateStatus(`Peer ${peerId.substring(0, 6)} is busy.`, 'orange');
    currentAppState = AppState.INITIAL;
    setInteractionUiEnabled(false);
    await displayFriendList();
}
function setupEventListeners() {
    window.addEventListener('resize', () => {
        if (qrElement && qrElement.style.display !== 'none') {
            const myAppUrl = window.location.origin + '/?id=' + myDeviceId;
            updateQrCodeWithValue(myAppUrl);
        }
    });
    sendMessageButton?.addEventListener('click', handleSendMessage);
    sendPostButton?.addEventListener('click', handleSendPost);
    sendFileButton?.addEventListener('click', handleSendFile);
    callButton?.addEventListener('click', toggleVideoCall);
    videoButton?.addEventListener('click', toggleLocalVideo);
    startScanButton?.addEventListener('click', handleStartScanClick);
    acceptCallButton?.addEventListener('click', handleAcceptCall);
    rejectCallButton?.addEventListener('click', handleRejectCall);
    messageInputElement?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !sendMessageButton.disabled) handleSendMessage();
    });
    postInputElement?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !sendPostButton.disabled) handleSendPost();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if ((!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) && !isAttemptingReconnect) {
            updateStatus('Re-checking connection...', 'blue');
            if (wsReconnectTimer) {
              clearTimeout(wsReconnectTimer);
              wsReconnectTimer = null;
            }
            wsReconnectAttempts = 0;
            connectWebSocket();
          } else if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
            startAutoConnectFriendsTimer();
          }
        } else {
          stopAutoConnectFriendsTimer();
        }
      });
    }
document.addEventListener('DOMContentLoaded', async () => {
  qrElement = document.getElementById('qrcode');
  statusElement = document.getElementById('connectionStatus');
  qrReaderElement = document.getElementById('qr-reader');
  qrResultsElement = document.getElementById('qr-reader-results');
  localVideoElement = document.getElementById('localVideo');
  remoteVideosContainer = document.getElementById('remoteVideosContainer');
  messageAreaElement = document.getElementById('messageArea');
  postAreaElement = document.getElementById('postArea');
  incomingCallModal = document.getElementById('incomingCallModal');
  callerIdElement = document.getElementById('callerId');
  acceptCallButton = document.getElementById('acceptCallButton');
  rejectCallButton = document.getElementById('rejectCallButton');
  friendListElement = document.getElementById('friendList');
  messageInputElement = document.getElementById('messageInput');
  sendMessageButton = document.getElementById('sendMessage');
  postInputElement = document.getElementById('postInput');
  sendPostButton = document.getElementById('sendPost');
  fileInputElement = document.getElementById('fileInput');
  sendFileButton = document.getElementById('sendFile');
  fileTransferStatusElement = document.getElementById('file-transfer-status');
  callButton = document.getElementById('callButton');
  videoButton = document.getElementById('videoButton');
  startScanButton = document.getElementById('startScanButton');
  if (!remoteVideosContainer) {
    remoteVideosContainer = document.querySelector('.video-scroll-container');
  }
  if (statusElement) {
    statusElement.addEventListener('click', () => {
      statusElement.classList.toggle('status-expanded');
    });
  }

  if (typeof idb === 'undefined') {
      updateStatus("Database features disabled (idb library not loaded).", "orange");
  } else if (!dbPromise) {
      updateStatus("Database initialization failed.", "red");
  }
  myDeviceId = localStorage.getItem('cybernetcall-deviceId') || generateUUID();
  localStorage.setItem('cybernetcall-deviceId', myDeviceId);
  await displayInitialPosts();
  setupEventListeners();
  if (myDeviceId && typeof myDeviceId === 'string' && myDeviceId.length > 0) {
    const myAppUrl = window.location.origin + '/?id=' + myDeviceId;
    updateQrCodeWithValue(myAppUrl);
  } else {
    console.error("Device ID is not available. Cannot generate QR code.");
    updateStatus("Error: Device ID missing. Cannot generate QR code.", "red");
  }
  updateStatus('Initializing...', 'black');
  setInteractionUiEnabled(false);
  await displayFriendList();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/cnc/service-worker.js')
      .then(registration => {
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
                let refreshing;
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                     if (confirm('A new version of the app is available. Refresh now to get the latest features?')) {
                       if (registration.waiting) {
                           registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                       }
                       navigator.serviceWorker.addEventListener('controllerchange', () => {
                           if (refreshing) return;
                           window.location.reload();
                           refreshing = true;
                       });
                     } else {
                       updateStatus('New version available. Please refresh soon to update.', 'blue');
                     }
                }
              }
            };
          }
        };
      })
      .catch(error => {
        updateStatus(`Service Worker registration error: ${error.message}`, 'red');
      });
  } else {
    updateStatus('Offline features unavailable (Service Worker not supported)', 'orange');
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data && event.data.type === 'APP_ACTIVATED') {
        if ((!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) && !isAttemptingReconnect) {
            connectWebSocket();
        }
        startAutoConnectFriendsTimer();
      }
    });
  }
  await connectWebSocket();
  const urlParams = new URLSearchParams(window.location.search);
  const incomingFriendId = urlParams.get('id');
  if (incomingFriendId && incomingFriendId !== myDeviceId) {
      updateStatus(`Connecting from link with ${incomingFriendId.substring(0,6)}...`, 'blue');
      await addFriend(incomingFriendId);
      pendingConnectionFriendId = incomingFriendId;

    }

});
