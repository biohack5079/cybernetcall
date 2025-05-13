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
let roomInputElement, joinRoomButton;
let remoteVideosContainer;
let incomingCallModal, callerIdElement, acceptCallButton, rejectCallButton;
let currentCallerId = null;
let friendListElement;
let pendingConnectionFriendId = null;

// WebSocket auto-reconnect parameters
let wsReconnectAttempts = 0;
const MAX_WS_RECONNECT_ATTEMPTS = 5; // Max number of reconnect attempts
const INITIAL_WS_RECONNECT_DELAY_MS = 2000; // Initial delay in ms
const MAX_WS_RECONNECT_DELAY_MS = 30000;    // Max delay in ms
let wsReconnectTimer = null;
let isAttemptingReconnect = false; // Flag to indicate if a reconnect attempt is active

const CHUNK_SIZE = 16384;
let fileReader;
let receiveBuffer = {};
let receivedSize = {};
let incomingFileInfo = {};

let dbPromise = typeof idb !== 'undefined' ? idb.openDB('cybernetcall-db', 2, {
  upgrade(db, oldVersion) {
    if (!db.objectStoreNames.contains('posts')) {
      db.createObjectStore('posts', { keyPath: 'id' });
    }
    if (oldVersion < 2 && !db.objectStoreNames.contains('friends')) {
      db.createObjectStore('friends', { keyPath: 'id' });
    }
  }
}) : null;

if (!dbPromise) {
    console.error("idb library not loaded. IndexedDB features will be unavailable.");
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function updateStatus(message, color = 'black') {
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = color;
        statusElement.style.display = message ? 'block' : 'none';
    }
    console.log(`Status Update: ${message} (State: ${currentAppState})`);
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
    if (joinRoomButton) joinRoomButton.disabled = (currentAppState !== AppState.INITIAL);
    console.log(`Interaction UI (Chat, File, Call, Scan) ${enabled ? 'enabled' : 'disabled'}.`);
}

async function savePost(post) {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    const tx = db.transaction('posts', 'readwrite');
    await tx.store.put(post);
    await tx.done;
    console.log("Post saved:", post.id);
  } catch (error) {
    console.error("Error saving post:", error);
  }
}

async function deletePostFromDb(postId) {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    const tx = db.transaction('posts', 'readwrite');
    await tx.store.delete(postId);
    await tx.done;
    console.log("Post deleted from DB:", postId);
  } catch (error) {
    console.error("Error deleting post from DB:", postId, error);
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
        console.log(`Friend ${friendId} already exists.`);
        alert(`Friend (${friendId.substring(0,6)}) is already added.`);
        return;
    }
    await tx.store.put({ id: friendId, name: friendName, added: new Date() });
    await tx.done;
    console.log("Friend added:", friendId);
    alert(`Friend (${friendId.substring(0,6)}) added successfully! Attempting to connect...`);
    await displayFriendList();
  } catch (error) {
    console.error("Error adding friend:", error);
    alert("Failed to add friend.");
  }
}

async function isFriend(friendId) {
  if (!dbPromise || !friendId) return false;
  try {
    console.log(`[isFriend] Checking if ${friendId} is a friend. My ID: ${myDeviceId}`);
    const db = await dbPromise;
    const friend = await db.get('friends', friendId);
    // return !!friend;
    console.log(`[isFriend] Result for ${friendId}:`, friend ? {...friend} : null, `Is friend: ${!!friend}`);
    return !!friend; 
  } catch (error) {
    // console.error("Error checking if friend exists:", error);
    console.error(`[isFriend] Error checking if ${friendId} exists:`, error);
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
    console.log(`Displayed ${friends.length} friends.`);
  } catch (error) {
    console.error("Error displaying friend list:", error);
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
    console.log(`Displayed ${posts.length} initial posts.`);
  } catch (error) {
    console.error("Error displaying initial posts:", error);
  }
}

function displayPost(post, isNew = true) {
  if (!postAreaElement) return;
  const div = document.createElement('div');
  div.className = 'post';
  div.id = `post-${post.id}`;

  const contentSpan = document.createElement('span');
  const unsafeHTML = `<strong>${post.sender ? post.sender.substring(0, 6) : 'Unknown'}:</strong> ${post.content}`;
  contentSpan.innerHTML = DOMPurify.sanitize(unsafeHTML);

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

    console.log("Attempting to delete post:", postId);

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
    console.log('WebSocket already connected.');
    return;
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${location.host}/ws/signaling/`;
  console.log(`Connecting to WebSocket: ${wsUrl}`);
  updateStatus('Connecting to signaling server...', 'blue');
  signalingSocket = new WebSocket(wsUrl);

  signalingSocket.onopen = () => {
    console.log(`WebSocket connected (Attempt: ${wsReconnectAttempts + 1})`);
    wsReconnectAttempts = 0; // Reset on successful connection
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
    // Note: Friend list display and pending connections are handled after 'registered' message.
    // If re-establishing connections to existing friends is needed after a WS reconnect,
    // that logic would go into the 'registered' message handler, or by re-triggering
    // 'user_joined' like events if the server supports it.
    // Current app logic auto-connects on 'user_joined' if they are friends.
  };

  signalingSocket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      const messageType = message.type;
      const payload = message.payload || {};
      const senderUUID = message.from || message.uuid || payload.uuid;

      console.log('Received signaling message:', message);

      switch (messageType) {
        case 'registered':
            updateStatus('Connected to signaling server. Ready.', 'green');
            currentAppState = AppState.INITIAL;
            setInteractionUiEnabled(false);
            await displayFriendList();
            if (pendingConnectionFriendId) {
                console.log(`WebSocket registered, initiating pending connection to ${pendingConnectionFriendId}`);
                await createOfferForPeer(pendingConnectionFriendId);
                pendingConnectionFriendId = null;
            }
            break;
        case 'user_list':
            console.log('Currently online users:', message.users);
            break;
        case 'user_joined':
        case 'user_online':
            const joinedUUID = message.uuid;
            if (joinedUUID && joinedUUID !== myDeviceId && messageType === 'user_joined') {
                await displayFriendList();

                console.log(`[user_joined] Received user_joined for ${joinedUUID}. My current ID: ${myDeviceId}. Checking if friend...`);
                const friendExists = await isFriend(joinedUUID);
                if (friendExists) {
                    console.log(`Friend ${joinedUUID} joined the room.`);
                    updateStatus(`Friend ${joinedUUID.substring(0,6)} joined. Attempting to connect...`, 'blue');
                    console.log(`[user_joined] ${joinedUUID} IS a friend. Attempting auto-connect.`);
                    if (peers[joinedUUID]) {
                        // PeerConnectionが既に存在する
                        const currentState = peers[joinedUUID].connectionState;
                        if (currentState === 'connected' || currentState === 'connecting') {
                            console.log(`Already connected or connecting to friend ${joinedUUID} (state: ${currentState}), skipping auto-connect.`);
                        } else {
                            // connectedでもconnectingでもない場合 (例: disconnected, failed, closed)
                            // 相手が再接続してきた可能性があるので、既存の接続をクリーンアップして再試行
                            console.log(`Friend ${joinedUUID} re-joined or connection was in state ${currentState}. Closing old connection and re-attempting.`);
                            closePeerConnection(joinedUUID); // 古い接続を閉じる
                            console.log(`Auto-connecting to re-joined friend: ${joinedUUID}`);
                            await createOfferForPeer(joinedUUID); // 新しい接続を開始
                        }
                    } else {
                        // PeerConnectionが存在しない場合、新規接続
                        console.log(`Auto-connecting to newly joined friend: ${joinedUUID}`);
                        await createOfferForPeer(joinedUUID);
                    }
                } else {
                    console.log(`[user_joined] Peer ${joinedUUID} joined, but is NOT a friend. No auto-connection.`);
                    updateStatus(`Peer ${joinedUUID.substring(0,6)} joined (NOT a friend).`, 'gray');
                }
            }
            break;
        case 'user_left':
            const leftUUID = message.uuid;
             if (leftUUID && leftUUID !== myDeviceId) {
                console.log(`Peer ${leftUUID} left.`);
                updateStatus(`Peer ${leftUUID.substring(0,6)} left`, 'orange');
                closePeerConnection(leftUUID);
                await displayFriendList();
             }
            break;
        case 'offer':
            if (senderUUID) {
                console.log(`Received offer from ${senderUUID}`);
                await handleOfferAndCreateAnswer(senderUUID, payload.sdp);
            } else { console.warn("Offer received without sender UUID"); }
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
            } else { console.warn("ICE candidate received without sender UUID"); }
            break;
        case 'call-request':
             if (senderUUID) {
                console.log(`Incoming call request from ${senderUUID}`);
                handleIncomingCall(senderUUID);
            } else { console.warn("Call request received without sender UUID"); }
            break;
        case 'call-accepted':
             if (senderUUID) {
                console.log(`Call accepted by ${senderUUID}`);
                updateStatus(`Call accepted by ${senderUUID.substring(0,6)}. Connecting...`, 'blue');
                await createOfferForPeer(senderUUID);
            } else { console.warn("Call accepted received without sender UUID"); }
            break;
        case 'call-rejected':
             if (senderUUID) {
                console.log(`Call rejected by ${senderUUID}`);
                handleCallRejected(senderUUID);
            } else { console.warn("Call rejected received without sender UUID"); }
            break;
        case 'call-busy':
             if (senderUUID) {
                console.log(`Peer ${senderUUID} is busy.`);
                handleCallBusy(senderUUID);
            } else { console.warn("Call busy received without sender UUID"); }
            break;
      }
    } catch (error) {
      console.error('Failed to parse message or handle incoming signal:', error);
    }
  };

  signalingSocket.onclose = async (event) => {
    const code = event.code;
    const reason = event.reason;
    console.log(`WebSocket disconnected: Code=${code}, Reason='${reason}', Current Attempts=${wsReconnectAttempts}`);

    const socketInstanceThatClosed = event.target; // The WebSocket instance that fired this event

    // Clear event handlers from the closed socket instance to prevent memory leaks or unintended calls
    if (socketInstanceThatClosed) {
        socketInstanceThatClosed.onopen = null;
        socketInstanceThatClosed.onmessage = null;
        socketInstanceThatClosed.onerror = null;
        socketInstanceThatClosed.onclose = null;
    }

    // If the global signalingSocket is not this instance, it means a new connection might already be in progress or established.
    // Or, if isAttemptingReconnect is true and signalingSocket is null, it means this onclose is part of an ongoing attempt.
    if (signalingSocket !== socketInstanceThatClosed && signalingSocket !== null) {
        console.warn("onclose event from an outdated socket instance. Global signalingSocket points to a newer instance. Ignoring.");
        return;
    }
    
    signalingSocket = null;
    // Do not attempt to reconnect for normal closure codes
    if (code === 1000 || code === 1001) {
        console.log("WebSocket closed normally or going away. No reconnection attempt.");
        updateStatus('Signaling connection closed.', 'orange');
        resetConnection(); // Full reset of application state
        await displayFriendList();
        isAttemptingReconnect = false; // Ensure flag is reset
        wsReconnectAttempts = 0; // Reset attempts for future manual connections
        return;
      }
  
      if (wsReconnectAttempts >= MAX_WS_RECONNECT_ATTEMPTS) {
        console.error('WebSocket reconnection failed after maximum attempts.');
        updateStatus('Signaling connection lost. Please refresh the page.', 'red');
        resetConnection(); // Full reset
        await displayFriendList();
        isAttemptingReconnect = false;
        wsReconnectAttempts = 0; // Reset for next time
        return;
      }
  
      isAttemptingReconnect = true;
      wsReconnectAttempts++;
  
      let delay = INITIAL_WS_RECONNECT_DELAY_MS * Math.pow(1.5, wsReconnectAttempts - 1);
      delay = Math.min(delay, MAX_WS_RECONNECT_DELAY_MS);
  
      updateStatus(`Signaling disconnected. Reconnecting in ${Math.round(delay/1000)}s (Attempt ${wsReconnectAttempts}/${MAX_WS_RECONNECT_ATTEMPTS})...`, 'orange');
      console.log(`Scheduling WebSocket reconnect #${wsReconnectAttempts} in ${delay / 1000}s`);
  
      // Clean up peer connections and UI state during reconnection attempts
      Object.keys(peers).forEach(peerUUID => closePeerConnection(peerUUID));
      Object.values(dataChannels).forEach(channel => { if (channel && channel.readyState !== 'closed') channel.close(); });
      dataChannels = {};
      setInteractionUiEnabled(false);
      currentAppState = AppState.CONNECTING; // Indicate attempt to connect to signaling
  
      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(async () => {
        console.log(`Executing reconnect attempt #${wsReconnectAttempts}...`);
        await connectWebSocket(); // Attempt to establish a new WebSocket connection
      }, delay);
  };

  signalingSocket.onerror = (error) => {
    console.error('WebSocket error:', error);
    // updateStatus('Signaling connection error.', 'red'); // onclose will handle status updates
    // Errors usually trigger onclose. If the socket is still open/opening, close it to ensure onclose fires.
    if (signalingSocket && (signalingSocket.readyState === WebSocket.OPEN || signalingSocket.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket error occurred on an open/connecting socket, explicitly closing to trigger onclose for reconnection logic.");
        signalingSocket.close();
    } else if (!signalingSocket && !isAttemptingReconnect) {
        // This case might happen if the WebSocket constructor fails or an error occurs before onclose.
        // Trigger a manual simulation of onclose behavior if necessary.
        console.log("WebSocket error on a null socket without active reconnection. Manually invoking onclose-like behavior if needed.");
        // To be robust, one might call a function here that encapsulates the onclose reconnect logic,
        // e.g., handleWebSocketClosure({ code: -1, reason: "Generic error before close" });
        // For now, rely on onclose being triggered by most error scenarios.
    }
  };
}

function sendSignalingMessage(message) {
  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    if (!message.payload) message.payload = {};
    if (!message.payload.uuid) message.payload.uuid = myDeviceId;
    signalingSocket.send(JSON.stringify(message));
  } else {
    console.error('Cannot send signaling message: WebSocket is not open.');
    updateStatus('Signaling connection not ready.', 'red');
  }
}

async function createPeerConnection(peerUUID) {
  if (peers[peerUUID]) {
    console.warn(`Closing existing PeerConnection for ${peerUUID}.`);
    closePeerConnection(peerUUID);
  }
  console.log(`Creating PeerConnection for ${peerUUID}...`);
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
        console.log(`All ICE candidates have been gathered for ${peerUUID}.`);
      }
    };

    peer.ondatachannel = event => {
      console.log(`Data channel received from ${peerUUID}:`, event.channel.label);
      const channel = event.channel;
      channel.binaryType = 'arraybuffer';
      setupDataChannelEvents(peerUUID, channel);
    };

    peer.ontrack = (event) => {
      console.log(`Track received from ${peerUUID}:`, event.track.kind);
      handleRemoteTrack(peerUUID, event.track, event.streams[0]);
    };

    peer.onconnectionstatechange = () => {
      console.log(`PeerConnection state with ${peerUUID}: ${peer.connectionState}`);
      switch (peer.connectionState) {
        case 'connected':
          updateStatus(`Connected with ${peerUUID.substring(0,6)}!`, 'green');
          if (Object.keys(peers).filter(uuid => peers[uuid]?.connectionState === 'connected').length === 1) {
              setInteractionUiEnabled(true);
              currentAppState = AppState.CONNECTED;
          }
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          updateStatus(`Connection with ${peerUUID.substring(0,6)} closed (${peer.connectionState})`, 'orange');
          closePeerConnection(peerUUID);
          if (Object.keys(peers).length === 0) {
              setInteractionUiEnabled(false);
              currentAppState = AppState.INITIAL;
              updateStatus('All peers disconnected.', 'orange');
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
    console.log(`PeerConnection created for ${peerUUID}.`);
    return peer;
  } catch (error) {
    console.error(`Error creating PeerConnection for ${peerUUID}:`, error);
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
        console.log(`Data channel with ${peerUUID} opened!`);

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
        console.log(`Data channel with ${peerUUID} closed.`);
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
        console.error(`Data channel error with ${peerUUID}:`, error);
        updateStatus(`Data channel error: ${error}`, 'red');
        closePeerConnection(peerUUID);
    };
}

async function createOfferForPeer(peerUUID) {
    currentAppState = AppState.CONNECTING;
    const peer = await createPeerConnection(peerUUID);
    if (!peer) return;

    const offerSdp = await createOfferAndSetLocal(peerUUID);
    if (offerSdp) {
        console.log(`Sending offer to ${peerUUID}`);
        sendSignalingMessage({
            type: 'offer',
            payload: { target: peerUUID, sdp: offerSdp }
        });
    } else {
        console.error(`Failed to create offer for ${peerUUID}`);
        closePeerConnection(peerUUID);
    }
}

async function createOfferAndSetLocal(peerUUID) {
  const peer = peers[peerUUID];
  if (!peer) {
      console.error(`Cannot create offer: PeerConnection for ${peerUUID} not ready.`);
      return null;
  }
  console.log(`Creating DataChannel 'cybernetcall-data' for ${peerUUID}...`);
  try {
    const channel = peer.createDataChannel('cybernetcall-data');
    channel.binaryType = 'arraybuffer';
    setupDataChannelEvents(peerUUID, channel);

    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                peer.addTrack(track, localStream);
            } catch (e) { console.error(`Error adding track to ${peerUUID}:`, e); }
        });
    }

    console.log(`Creating Offer for ${peerUUID}...`);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    console.log(`Offer created and local description set for ${peerUUID}.`);
    return peer.localDescription;
  } catch (error) {
    console.error(`Error creating DataChannel, Offer or setting local description for ${peerUUID}:`, error);
    updateStatus(`Offer creation error for ${peerUUID}: ${error.message}`, 'red');
    return null;
  }
}

async function handleOfferAndCreateAnswer(peerUUID, offerSdp) {
  let peer = peers[peerUUID];
  const isRenegotiation = !!peer;

  if (!isRenegotiation) {
    //    console.log(`No existing PeerConnection for ${peerUUID}. Creating one...`);
    //    peer = await createPeerConnection(peerUUID);
    //    if (!peer) {
    //        console.error(`Failed to create PeerConnection for ${peerUUID} to handle offer.`);
    //        return;
    //    }
    console.log(`No existing PeerConnection for ${peerUUID}. Creating one...`);
    peer = await createPeerConnection(peerUUID);
    if (!peer) {
        console.error(`Failed to create PeerConnection for ${peerUUID} to handle offer.`);
        return;
    }

    const alreadyFriend = await isFriend(peerUUID);
    if (!alreadyFriend) {
        console.log(`[handleOfferAndCreateAnswer] Peer ${peerUUID} (sender of offer) is not a friend. Adding them now.`);
        await addFriend(peerUUID);
    }
  }
  console.log(`Received offer from ${peerUUID}, setting remote description...`);
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(offerSdp));

    if (localStream) {
        localStream.getTracks().forEach(track => {
            try {
                const senderExists = peer.getSenders().find(s => s.track === track);
                if (!senderExists) {
                    peer.addTrack(track, localStream);
                    console.log(`Added existing ${track.kind} track to ${peerUUID} on offer`);
                }
            } catch (e) { console.error(`Error adding existing track to ${peerUUID} on offer:`, e); }
        });
    }

    console.log(`Creating Answer for ${peerUUID}...`);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    console.log(`Answer created and local description set for ${peerUUID}.`);
    sendSignalingMessage({
        type: 'answer',
        payload: { target: peerUUID, sdp: peer.localDescription }
    });
    console.log(`Sent ${isRenegotiation ? 'renegotiation ' : ''}answer to ${peerUUID}.`);
  } catch (error) {
    console.error(`Error handling offer or creating/setting answer for ${peerUUID}:`, error);
    updateStatus(`Offer handling / Answer creation error for ${peerUUID}: ${error.message}`, 'red');
    closePeerConnection(peerUUID);
  }
}

async function handleAnswer(peerUUID, answerSdp) {
  const peer = peers[peerUUID];
  if (!peer) {
       console.error(`Cannot handle answer: PeerConnection for ${peerUUID} not found.`);
       return null;
  }
  const isRenegotiationAnswer = peer.signalingState === 'have-local-offer';
  console.log(`Received ${isRenegotiationAnswer ? 'renegotiation ' : ''}answer from ${peerUUID}, setting remote description...`);
  try {
    await peer.setRemoteDescription(new RTCSessionDescription(answerSdp));
    console.log(`Remote description set with answer for ${peerUUID}. Connection should establish soon.`);
    return true;
  } catch (error) {
    console.error(`Error setting remote description with answer for ${peerUUID}:`, error);
    updateStatus(`Answer handling error for ${peerUUID}: ${error.message}`, 'red');
    return false;
  }
}

async function handleIceCandidate(peerUUID, candidate) {
  const peer = peers[peerUUID];
  if (!peer) {
    return;
  }
  if (candidate) {
    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      if (!error.message.includes("Cannot add ICE candidate in state") && !error.message.includes("Error processing ICE candidate")) {
          console.error(`Error adding received ICE candidate for ${peerUUID}:`, error);
      }
    }
  }
}

function resetConnection() {
    console.log("Resetting connection state...");
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
            signalingSocket.close(1000); // Normal closure
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

    Object.values(peers).forEach(peer => {
        if (peer) {
            peer.onicecandidate = null;
            peer.ondatachannel = null;
            peer.ontrack = null;
            peer.onconnectionstatechange = null;
            peer.close();
        }
    });
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
    receiveBuffer = {};
    receivedSize = {};
    incomingFileInfo = {};
    if (fileTransferStatusElement) fileTransferStatusElement.textContent = '';
    currentCallerId = null;
    if (incomingCallModal) incomingCallModal.style.display = 'none';

    if(qrReaderElement) qrReaderElement.style.display = 'none';
    if(roomInputElement) roomInputElement.disabled = true;
    if(joinRoomButton) joinRoomButton.disabled = true;
    if(startScanButton) startScanButton.disabled = false;
    updateStatus('Ready. Add friends or wait for connection.', 'black');
    setInteractionUiEnabled(false);
    // Clear any pending reconnect timer if resetConnection is called explicitly
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
    isAttemptingReconnect = false;    
    if(messageAreaElement) messageAreaElement.innerHTML = '';
    if(postAreaElement) postAreaElement.innerHTML = '';
}

function closePeerConnection(peerUUID) {
    const peer = peers[peerUUID];
    if (peer) {
        console.log(`Closing PeerConnection with ${peerUUID}`);
        peer.onicecandidate = null;
        peer.ondatachannel = null;
        peer.ontrack = null;
        peer.onconnectionstatechange = null;
        peer.close();
        delete peers[peerUUID];
    }
    const channel = dataChannels[peerUUID];
    if (channel) {
        channel.close();
    }
    const videoElement = document.getElementById(`remoteVideo-${peerUUID}`);
    if (videoElement) {
        videoElement.remove();
    }
    if (Object.keys(peers).length === 0) {
        setInteractionUiEnabled(false);
        currentAppState = AppState.INITIAL;
        updateStatus(`Last peer disconnected.`, 'orange');
    }
}

function handleDataChannelMessage(event, senderUUID) {
  if (event.data instanceof ArrayBuffer) {
    try {
        const message = JSON.parse(new TextDecoder().decode(event.data));
        if (message.type === 'file-chunk') {
             processFileChunk(message);
        } else {
             processTextMessage(new TextDecoder().decode(event.data), senderUUID);
        }
    } catch(e) {
        console.warn("Received ArrayBuffer that wasn't a JSON chunk, attempting text decode:", e);
        processTextMessage(new TextDecoder().decode(event.data), senderUUID);
    }
  } else if (typeof event.data === 'string') {
    processTextMessage(event.data, senderUUID);
  } else {
    console.warn("Received unexpected data type:", typeof event.data);
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
                console.log("Received delete request for post:", message.postId);
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
                receiveBuffer[message.fileId] = [];
                receivedSize[message.fileId] = 0;
                console.log(`[File Metadata] Initialized receivedSize for ${message.fileId} to 0`);
                console.log(`Receiving metadata for file: ${message.name} (${message.size} bytes) from ${senderUUID.substring(0,6)}`);
                if (fileTransferStatusElement) {
                    fileTransferStatusElement.textContent = `Receiving ${message.name}... 0%`;
                }
                break;
            case 'file-chunk':
                 processFileChunk(message);
                 break;
            default:
                console.warn("Received unknown message type:", message.type);
                if (!message.type && message.content && message.id) {
                     console.log("Assuming received data is a post (legacy format).");
                     await savePost(message);
                     displayPost(message, true);
                }
        }
    } catch (error) {
        console.error("Error parsing received data:", error, dataString);
    }
}

function processFileChunk(chunkMessage) {
    const fileId = chunkMessage.fileId;
    const chunkIndex = chunkMessage.index;
    const isLast = chunkMessage.last;

    if (!incomingFileInfo[fileId] || !receiveBuffer[fileId]) {
        console.error("Received chunk for unknown file transfer:", fileId);
        return;
    }

    try {
        const byteString = atob(chunkMessage.data);
        const byteArray = new Uint8Array(byteString.length);
        for (let i = 0; i < byteString.length; i++) {
            byteArray[i] = byteString.charCodeAt(i);
        }
        const chunk = byteArray.buffer;

        const isNewChunkForSizeCalculation = receiveBuffer[fileId][chunkIndex] === undefined;

        receiveBuffer[fileId][chunkIndex] = chunk;

        if (isNewChunkForSizeCalculation) {
            if ((receivedSize[fileId] + chunk.byteLength) > incomingFileInfo[fileId].size && !isLast) {
                 console.error(`[File Receive Error] Receiving new chunk ${chunkIndex} for file ${fileId} (size ${chunk.byteLength}) would exceed expected total size (${incomingFileInfo[fileId].size}). Current received: ${receivedSize[fileId]}. Aborting.`);
                 if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Error receiving ${incomingFileInfo[fileId].name} (size mismatch)`;
                 delete incomingFileInfo[fileId];
                 delete receiveBuffer[fileId];
                 delete receivedSize[fileId];
                 return;
            }
            receivedSize[fileId] += chunk.byteLength;
        } else {
            console.warn(`[File Chunk] Chunk ${chunkIndex} for file ${fileId} was already present or re-processed. Size not re-added to avoid duplication. Current total received: ${receivedSize[fileId]}`);
        }

        console.log(`[File Chunk] ID: ${fileId}, Index: ${chunkIndex}, Size: ${chunk.byteLength}, Total Received: ${receivedSize[fileId]}, Expected Size: ${incomingFileInfo[fileId].size}, Is Last: ${isLast}`);

        const progress = Math.round((receivedSize[fileId] / incomingFileInfo[fileId].size) * 100);
         if (fileTransferStatusElement) {
            fileTransferStatusElement.textContent = `Receiving ${incomingFileInfo[fileId].name}... ${progress}%`;
        }

        if (isLast) {
            if (receivedSize[fileId] !== incomingFileInfo[fileId].size) {
                console.error(`[File Assembly Error] Final size mismatch for file ${fileId}. Expected ${incomingFileInfo[fileId].size}, but received ${receivedSize[fileId]}.`);
                if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Error assembling ${incomingFileInfo[fileId].name} (final size error)`;
                delete incomingFileInfo[fileId];
                delete receiveBuffer[fileId];
                delete receivedSize[fileId];
                return;
            }

            console.log("Received last chunk for file:", incomingFileInfo[fileId].name);
            const receivedChunkCount = receiveBuffer[fileId].filter(c => c !== undefined).length;
            const expectedChunks = chunkIndex + 1;

            if (receivedChunkCount < expectedChunks) {
                 console.warn(`Missing chunks for file ${fileId}. Expected ${expectedChunks}, got ${receivedChunkCount}. Cannot assemble.`);
                 if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Error receiving ${incomingFileInfo[fileId].name} (missing chunks)`;
                 delete incomingFileInfo[fileId];
                 delete receiveBuffer[fileId];
                 delete receivedSize[fileId];
                 return;
            }

            const fileBlob = new Blob(receiveBuffer[fileId], { type: incomingFileInfo[fileId].type });

            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(fileBlob);
            downloadLink.download = incomingFileInfo[fileId].name;
            downloadLink.textContent = `Download ${incomingFileInfo[fileId].name}`;
            downloadLink.style.display = 'block';
            downloadLink.style.marginTop = '5px';

            if (fileTransferStatusElement) {
                fileTransferStatusElement.textContent = '';
                fileTransferStatusElement.appendChild(downloadLink);
            } else {
                messageAreaElement.appendChild(downloadLink);
            }

            delete incomingFileInfo[fileId];
            delete receiveBuffer[fileId];
            delete receivedSize[fileId];
        }
    } catch (error) {
        console.error("Error processing file chunk:", error, chunkMessage);
        if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Error processing chunk for ${incomingFileInfo[fileId]?.name}`;
        delete incomingFileInfo[fileId];
        delete receiveBuffer[fileId];
        delete receivedSize[fileId];
    }
}

function broadcastMessage(messageString) {
    const openChannels = Object.entries(dataChannels).filter(([uuid, dc]) => dc && dc.readyState === 'open');
    if (openChannels.length > 0) {
        openChannels.forEach(([uuid, dc]) => {
            try {
                dc.send(messageString);
            } catch (error) {
                console.error(`Error sending message to ${uuid}:`, error);
            }
        });
        return true;
    } else {
        console.warn("Cannot broadcast message: No open DataChannels.");
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

    const unsafeHTML = `<strong>${senderName}:</strong> ${message.content}`;
    div.innerHTML = DOMPurify.sanitize(unsafeHTML);

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
        console.log("Post saved locally, but not sent (no open DataChannel).");
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
    console.log(`Preparing to send file: ${file.name}, size: ${file.size}, ID: ${fileId}`);

    if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Sending ${file.name}... 0%`;
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
        if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'File read error';
        sendFileButton.disabled = false;
    });
    fileReader.addEventListener('abort', event => {
        console.log('FileReader abort:', event);
        if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'File send aborted';
        sendFileButton.disabled = false;
    });
    fileReader.addEventListener('load', e => {
        const chunk = e.target.result;

        if (openChannels.length > 0) {
            const firstChannel = openChannels[0][1];
            const bufferedAmount = firstChannel.bufferedAmount || 0;
            if (bufferedAmount > CHUNK_SIZE * 8) {
                console.warn(`DataChannel buffer high (${bufferedAmount}), pausing send...`);
                setTimeout(() => {
                    sendFileChunk(chunk, file.name, snapshottedFileSize, fileId, chunkIndex, offset);
                }, 200);
                return;
            }
        } else {
            console.warn("No open channels to send file chunk.");
            sendFileButton.disabled = false;
            return;
        }
        sendFileChunk(chunk, file.name, snapshottedFileSize, fileId, chunkIndex, offset);
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

    const sendFileChunk = (chunkData, originalFileName, originalFileSizeInLogic, currentFileId, currentChunkIndex, currentOffset, retryCount = 0) => {
         try {
             const base64String = btoa(String.fromCharCode(...new Uint8Array(chunkData)));
             const chunkMessage = {
                 type: 'file-chunk',
                 fileId: currentFileId,
                 index: currentChunkIndex,
                 last: ((currentOffset + chunkData.byteLength) >= originalFileSizeInLogic),
                 data: base64String
             };
             const chunkString = JSON.stringify(chunkMessage);

             if (!broadcastMessage(chunkString) && retryCount < 3) {
                 throw new Error("Failed to send chunk to any peer.");
             }

             const newOffset = currentOffset + chunkData.byteLength;

             const progress = Math.round((newOffset / originalFileSizeInLogic) * 100);
             if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Sending ${originalFileName}... ${progress}%`;

             if (newOffset < originalFileSizeInLogic) {
                offset = newOffset;
                 chunkIndex++;
                 setTimeout(() => readSlice(newOffset), 0);
             } else {
                 console.log(`File ${originalFileName} sent successfully.`);
                 if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Sent ${originalFileName}`;
                 if(fileInputElement) fileInputElement.value = '';
                 sendFileButton.disabled = false;
             }
         } catch (error) {
             console.error(`Error sending chunk ${currentChunkIndex}:`, error);
             if (retryCount < 3) {
                 console.log(`Retrying chunk ${currentChunkIndex} (attempt ${retryCount + 1})...`);
                 setTimeout(() => sendFileChunk(chunkData, originalFileName, originalFileSizeInLogic, currentFileId, currentChunkIndex, currentOffset, retryCount + 1), 1000);
             } else {
                 alert(`Failed to send chunk ${currentChunkIndex} after multiple retries.`);
                 if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'Chunk send error';
                 sendFileButton.disabled = false;
             }
         }
    }
    readSlice(0);
}

async function toggleVideoCall() {
    if (currentAppState !== AppState.CONNECTED && currentAppState !== AppState.CONNECTING) {
        console.warn("Call button clicked but not connected.");
        alert("Please connect to a peer first.");
        return;
    }
    if (!localStream) {
        console.log("Starting video call...");
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideoElement) localVideoElement.srcObject = localStream;

            const renegotiationPromises = Object.entries(peers).map(async ([peerUUID, peer]) => {
                console.log(`[toggleVideoCall START] Processing peer: ${peerUUID}, State: ${peer?.connectionState}`);
                if (peer) {
                    localStream.getTracks().forEach(track => {
                        try {
                            if (peer.addTrack) {
                                const sender = peer.addTrack(track, localStream);
                                console.log(`Added ${track.kind} track to ${peerUUID}`);
                            } else { console.warn(`peer.addTrack is not supported for ${peerUUID}.`); }
                        } catch (e) { console.error(`Error adding track to ${peerUUID}:`, e); }
                    });
                    console.log(`[toggleVideoCall START] Attempting renegotiation for ${peerUUID}`);
                    await createAndSendOfferForRenegotiation(peerUUID, peer);
                }
            });
            await Promise.all(renegotiationPromises);

            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = false;
                if(videoButton) videoButton.textContent = '🚫';
                console.log(`Local video started disabled`);
            }
            if(callButton) callButton.textContent = 'End Call';
        } catch (error) {
            console.error(`Error starting video call (getUserMedia): Name: ${error.name}, Message: ${error.message}`, error);
            alert(`Media access error: ${error.message}`);
            localStream = null;
        }
    } else {
        console.log("Ending video call...");
        localStream.getTracks().forEach(track => track.stop());
        const tracksToRemove = localStream.getTracks();
        localStream = null;

        const renegotiationPromises = Object.entries(peers).map(async ([peerUUID, peer]) => {
            console.log(`[toggleVideoCall END] Processing peer: ${peerUUID}, State: ${peer?.connectionState}`);
            if (peer) {
                peer.getSenders().forEach(sender => {
                    if (sender && sender.track && tracksToRemove.includes(sender.track)) {
                        try {
                            if (peer.removeTrack) {
                                peer.removeTrack(sender);
                                console.log(`Removed ${sender.track.kind} track from ${peerUUID}`);
                            } else { console.warn(`peer.removeTrack is not supported for ${peerUUID}.`); }
                        } catch (e) { console.error(`Error removing track from ${peerUUID}:`, e); }
                    }
                });
                console.log(`[toggleVideoCall END] Attempting renegotiation for ${peerUUID}`);
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
    console.log(`Starting renegotiation with ${peerUUID}...`);
    try {
        console.log(`[Renegotiation] Creating offer for ${peerUUID}...`);
        const offer = await peer.createOffer();
        console.log(`[Renegotiation] Offer created for ${peerUUID}. Setting local description...`);
        await peer.setLocalDescription(offer);
        console.log(`[Renegotiation] Local description set for ${peerUUID}.`);
        console.log(`Renegotiation offer created for ${peerUUID}, sending...`);
        sendSignalingMessage({
            type: 'offer',
            payload: { target: peerUUID, sdp: peer.localDescription }
        });
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
            console.log(`Local video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
        }
    }
}

function handleRemoteTrack(peerUUID, track, stream) {
    console.log(`[handleRemoteTrack] Called for peer ${peerUUID}, track kind: ${track.kind}, stream ID: ${stream?.id}`);
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
            console.log(`Added ${track.kind} track (${track.id}) from ${peerUUID} to existing video element.`);
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
    console.log("Updating QR Code to show own User ID for adding friends.");
    const size = Math.min(window.innerWidth * 0.7, 250);
    if (typeof QRious !== 'undefined' && value) {
        try {
            new QRious({ element: qrElement, value: value || '', size: size, level: 'L' });
            qrElement.style.display = 'block';
            console.log("QR code updated and set to display: block");
        } catch (e) {
             console.error("QRious error:", e);
             qrElement.textContent = "QR Code Generation Error";
        }
    } else if (!value) {
         console.warn("No value provided to update QR code.");
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
    console.log("Starting QR scanner to add a friend...");
    if (window.html5QrCodeScanner && window.html5QrCodeScanner.getState() === 2 ) {
        console.log("Scanner already running.");
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
            console.log(`QR Scan success: ${decodedText ? decodedText.substring(0, 50) + '...' : ''}`);
            updateStatus('QR Scan successful. Processing...', 'blue');

            window.html5QrCodeScanner.stop().then(ignore => {
                console.log("QR Scanner stopped after success.");
                if(qrReaderElement) qrReaderElement.style.display = 'none';
                 handleScannedQrData(decodedText);
            }).catch(err => {
                 console.error("QR Scanner stop failed after success:", err);
                 if(qrReaderElement) qrReaderElement.style.display = 'none';
                 handleScannedQrData(decodedText);
            }).finally(() => {
                 if(startScanButton) startScanButton.disabled = false;
            });
        };
        const config = { fps: 10, qrbox: { width: 200, height: 200 } };

        console.log("Starting QR scanner...");
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
    console.log("Handling scanned data (expecting URL with friend ID):", decodedText ? decodedText.substring(0, 80) + '...' : '');
    if(startScanButton) startScanButton.disabled = false;

    try {
        const url = new URL(decodedText);
        const params = new URLSearchParams(url.search);
        const friendId = params.get('id');

        if (friendId) {
            console.log("Found friend ID in scanned URL:", friendId);
            await addFriend(friendId);
            if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
                console.log(`Attempting to initiate connection to ${friendId} after scan.`);
                updateStatus(`Connecting to ${friendId.substring(0,6)}...`, 'blue');
                await createOfferForPeer(friendId);
            } else { console.warn("WebSocket not ready, cannot initiate connection automatically after scan."); }
        } else {
            const msg = "Invalid QR code: URL does not contain an 'id' parameter.";
            console.warn(msg);
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

    console.log(`Attempting to call friend: ${friendId}`);
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
        console.log(`Received call from ${callerId} but already busy. Sending busy signal.`);
        sendSignalingMessage({ type: 'call-busy', payload: { target: callerId } });
        return;
    }

    currentCallerId = callerId;
    if (callerIdElement) callerIdElement.textContent = callerId.substring(0, 8) + '...';
    if (incomingCallModal) incomingCallModal.style.display = 'block';
}

async function handleAcceptCall() {
    if (!currentCallerId) return;
    console.log(`Accepting call from ${currentCallerId}`);
    if (incomingCallModal) incomingCallModal.style.display = 'none';
    updateStatus(`Accepting call from ${currentCallerId.substring(0,6)}. Connecting...`, 'blue');

    sendSignalingMessage({ type: 'call-accepted', payload: { target: currentCallerId } });

    await createPeerConnection(currentCallerId);
    currentAppState = AppState.CONNECTING;
}

function handleRejectCall() {
    if (!currentCallerId) return;
    console.log(`Rejecting call from ${currentCallerId}`);
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
          console.log('App became visible. Checking WebSocket connection.');
          // isAttemptingReconnect フラグも考慮して、既存の再接続処理と競合しないようにする
          if ((!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) && !isAttemptingReconnect) {
            console.log('WebSocket not connected or in a bad state upon visibility change. Attempting to reconnect.');
            updateStatus('Re-checking connection...', 'blue');
            // 既存の再接続ロジックを尊重しつつ、再接続を促す
            // 既にタイマーが動いている場合はそれをクリアし、試行回数をリセットして最初から試みる
            if (wsReconnectTimer) {
              clearTimeout(wsReconnectTimer);
              wsReconnectTimer = null;
            }
            wsReconnectAttempts = 0; // 新規の再接続シーケンスとして扱う
            // isAttemptingReconnect は connectWebSocket 内で true に設定される
            connectWebSocket();
          } else if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
            console.log('WebSocket is connected upon visibility change.');
          } else if (isAttemptingReconnect) {
            console.log('WebSocket reconnection attempt already in progress upon visibility change.');
          }
        } else {
          console.log('App became hidden.');
        }
      });

    console.log("Event listeners set up.");
    }

document.addEventListener('DOMContentLoaded', async () => {
  console.log("DOM fully loaded and parsed. Initializing app...");

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
  roomInputElement = document.getElementById('roomInput');
  joinRoomButton = document.getElementById('joinRoomButton');
  startScanButton = document.getElementById('startScanButton');

  if (!remoteVideosContainer) {
    remoteVideosContainer = document.querySelector('.video-scroll-container');
  }

  if (typeof idb === 'undefined') {
      updateStatus("Database features disabled (idb library not loaded).", "orange");
  } else if (!dbPromise) {
      console.error("IndexedDB could not be opened.");
      updateStatus("Database initialization failed.", "red");
  }

  myDeviceId = localStorage.getItem('cybernetcall-deviceId') || generateUUID();
  localStorage.setItem('cybernetcall-deviceId', myDeviceId);
  console.log("My Device ID:", myDeviceId);

  await displayInitialPosts();

  setupEventListeners();

  const myAppUrl = window.location.origin + '/?id=' + myDeviceId;
  console.log("Generating QR code for URL:", myAppUrl);
  updateQrCodeWithValue(myAppUrl);

  updateStatus('Initializing...', 'black');
  setInteractionUiEnabled(false);

  await displayFriendList();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/cnc/service-worker.js')
      .then(registration => {
        console.log('Service Worker registered successfully with scope:', registration.scope);
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
                let refreshing; // リロード処理の重複実行を防ぐフラグ        
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                     // 新しいコンテンツが利用可能で、現在のページは古いSWによって制御されている
                     console.log('New content is available and has been installed. Please refresh to update.');
                     // ユーザーに更新を促すシンプルなconfirmダイアログ
                     if (confirm('A new version of the app is available. Refresh now to get the latest features?')) {
                       // 新しいService Workerが待機状態(waiting)の場合、skipWaitingを指示して即座にアクティベートさせる
                       // (ただし、installイベントで既にself.skipWaiting()を呼んでいるので、通常は不要かもしれない)
                       if (registration.waiting) {
                           registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                       }
                       // controllerchangeイベントを監視し、新しいSWが制御を開始したらリロード
                       navigator.serviceWorker.addEventListener('controllerchange', () => {
                           if (refreshing) return;
                           window.location.reload();
                           refreshing = true;
                       });
                     } else {
                       updateStatus('New version available. Please refresh soon to update.', 'blue');
                     }
                } else {
                     // 初めてService Workerが登録され、コンテンツがキャッシュされた場合
                    console.log('Content is cached for offline use.');
                }
              }
            };
          }
        };
      })
      .catch(error => {
        console.error('Service Worker registration failed:', error);
        updateStatus(`Service Worker registration error: ${error.message}`, 'red');
      });
  } else {
    console.log("Service Worker not supported.");
    updateStatus('Offline features unavailable (Service Worker not supported)', 'orange');
  }

  console.log("App initialization complete.");
  await connectWebSocket();

  const urlParams = new URLSearchParams(window.location.search);
  const incomingFriendId = urlParams.get('id');
  if (incomingFriendId && incomingFriendId !== myDeviceId) {
      console.log(`Detected incoming friend ID from URL: ${incomingFriendId}`);
      updateStatus(`Connecting from link with ${incomingFriendId.substring(0,6)}...`, 'blue');
      await addFriend(incomingFriendId);
      pendingConnectionFriendId = incomingFriendId;
  }

});
