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
let directFileInputElement, sendDirectFileButton, directFileTransferStatusElement;
let groupFileInputElement, sendGroupFileButton, groupFileTransferStatusElement;
let onlineFriendSelector;
let callButton, frontCamButton, backCamButton, startScanButton;let remoteVideosContainer;
let incomingCallModal, callerIdElement, acceptCallButton, rejectCallButton;
let currentCallerId = null;
let friendListElement;
let pendingConnectionFriendId = null;
let selectedPeerId = null; // 1-on-1チャットの相手
let receivedSize = {};
let incomingFileInfo = {};
let lastReceivedFileChunkMeta = {};
let onlineFriendsCache = new Set();
let offlineActivityCache = new Set();
let isSubscribed = false; // ユーザーの課金状態を保持
let autoConnectFriendsTimer = null;
let currentFacingMode = 'user'; // 現在のカメラ向き(user: 前面, environment: 背面)
let html5QrCode = null; // QRコードスキャナのインスタンスを保持
let isScanning = false; // スキャン中かどうかのフラグ
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

// i18n (Internationalization) support
const i18n = {
    en: {
        friends: "Friends",
        noFriends: "No friends added yet. Scan their QR code!",
        onlineNow: "Online now!",
        wasOnline: "Was online",
        lastSeen: "Last seen",
        offline: "Offline",
        onlineSince: "Online since",
        justNow: "Just now",
        call: "",
        missedCallFrom: "Missed call from",
        at: "at",
        freeTrial: "Free Trial",
        mail: "Mail",
        sendMail: "Send Mail",
        cancel: "Cancel",
        nextAccess: "Next Access",
        mailSent: "Mail sent!",
        mailReceived: "You got mail!",
        content: "Content",
        newMailNotification: "New mail from",
        clickToView: "Click to view",
    },
    ja: {
        friends: "友達",
        noFriends: "まだ友達がいません。QRコードをスキャンしてください！",
        onlineNow: "オンライン",
        wasOnline: "不在着信",
        lastSeen: "最終接続",
        offline: "オフライン",
        onlineSince: "接続",
        justNow: "たった今",
        call: "",
        missedCallFrom: "不在着信 from",
        at: "at", // 必要に応じて変更
        freeTrial: "無料期間",
        mail: "メール",
        sendMail: "送信",
        cancel: "キャンセル",
        nextAccess: "次回アクセス予定",
        mailSent: "メールを送信しました！",
        mailReceived: "メールが届きました！",
        content: "本文",
        newMailNotification: "新着メール from",
        clickToView: "クリックして表示",
    }
};

function getLang() {
    return navigator.language.startsWith('ja') ? 'ja' : 'en';
}

const MAX_WS_RECONNECT_DELAY_MS = 5000;
let wsReconnectTimer = null;
let isAttemptingReconnect = false;
const CHUNK_SIZE = 16384;
let fileReader;
const DB_NAME = 'cybernetcall-db';
const DB_VERSION = 4;
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
    if (oldVersion < 4 && !db.objectStoreNames.contains('mails')) {
      const store = db.createObjectStore('mails', { keyPath: 'id' });
      store.createIndex('by_sender', 'sender');
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
    // 紫色のメッセージを最優先し、それ以外は新しい順にソートする
    const sortedMessages = [...statusMessages].sort((a, b) => {
        const aIsPriority = a.color === 'purple';
        const bIsPriority = b.color === 'purple';

        if (aIsPriority && !bIsPriority) return -1; // a (purple) を先に
        if (!aIsPriority && bIsPriority) return 1;  // b (purple) を先に

        // 同じ優先度の場合は、新しいものが上に来るようにタイムスタンプで降順ソート
        return b.timestamp - a.timestamp;
    });

    sortedMessages.forEach(msgObj => {
        const div = document.createElement('div');
        div.textContent = msgObj.text;
        div.style.color = msgObj.color;
        statusElement.appendChild(div);
    });
    statusElement.style.display = statusMessages.length > 0 ? 'block' : 'none';
}

function updateStatus(message, color = 'black', withTimestamp = true) {
    if (!statusElement) return;

    const messageText = String(message || '');

    // 明示的に空のメッセージが指定された場合は、全てのステータスをクリアする
    if (messageText === '') {
        statusMessages = [];
        renderStatusMessages();
        return;
    }

    // タイムスタンプ付きのメッセージを生成
    const timestamp = new Date();
    const displayMessage = withTimestamp ? `[${timestamp.toLocaleTimeString()}] ${messageText}` : messageText;

    // 同じ内容のメッセージが直近にあれば追加しない
    if (statusMessages.length > 0 && statusMessages[0].text.endsWith(messageText)) {
        renderStatusMessages();
        return;
    }
    const newMessage = {
        id: generateUUID(), // メッセージごとのユニークID
        text: displayMessage,
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
    if (directFileInputElement) directFileInputElement.disabled = disabled;
    if (groupFileInputElement) groupFileInputElement.disabled = disabled;
    if (onlineFriendSelector) onlineFriendSelector.disabled = disabled;
    if (sendDirectFileButton) sendDirectFileButton.disabled = disabled;
    if (sendGroupFileButton) sendGroupFileButton.disabled = disabled;
    if (callButton) callButton.disabled = disabled;
    // ビデオ会議がアクティブな場合のみ、カメラボタンの状態を更新
    if (localStream) {
        if (frontCamButton) frontCamButton.disabled = disabled;
        if (backCamButton) backCamButton.disabled = disabled;
    }
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
    await tx.store.put({ id: friendId, name: friendName, added: new Date(), lastSeen: null });
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
async function updateFriendLastSeen(friendId, seenTime = null) {
    if (!dbPromise || !friendId) return;
    try {
        const db = await dbPromise;
        const tx = db.transaction('friends', 'readwrite');
        const friend = await tx.store.get(friendId);
        if (friend) {
            // 指定された時刻、または現在時刻で更新
            friend.lastSeen = seenTime ? new Date(seenTime) : new Date();
            await tx.store.put(friend);
            await tx.done;
        }
    } catch (error) {
        console.error(`Failed to update lastSeen for friend ${friendId}:`, error);
    }
}
async function displayFriendList() {
  if (!dbPromise || !friendListElement) return;
  try {
    const lang = getLang();
    const db = await dbPromise;
    let friends = await db.getAll('friends');
    friendListElement.innerHTML = `<h3>${i18n[lang].friends}</h3>`;
    if (friends.length === 0) {
        friendListElement.innerHTML += `<p>${i18n[lang].noFriends}</p>`;
        return;
    }

    // オンラインの友達を先に、オフラインの友達を後にソート
    friends.sort((a, b) => {
        const aIsOnline = onlineFriendsCache.has(a.id);
        const bIsOnline = onlineFriendsCache.has(b.id);
        
        // 足跡表示の条件（権限チェック含む）をソートにも適用
        const checkFootprint = (friend) => {
            const addedDate = friend.added ? new Date(friend.added) : null;
            const now = new Date();
            const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;
            const isInFreeTrial = addedDate && (now - addedDate) < thirtyDaysInMillis;
            return (isSubscribed || isInFreeTrial) && offlineActivityCache.has(friend.id);
        };

        const aIsPurple = checkFootprint(a) && !aIsOnline;
        const bIsPurple = checkFootprint(b) && !bIsOnline;

        // 1. 足跡（紫） > 2. オンライン（緑） > 3. オフライン
        if (aIsPurple !== bIsPurple) return aIsPurple ? -1 : 1;
        if (aIsOnline !== bIsOnline) return aIsOnline ? -1 : 1;

        // 上記が同じ場合は、追加日が新しい順
        return new Date(b.added || 0) - new Date(a.added || 0);
    });

    friends.forEach(friend => {
        // ピア接続が確立しているか、またはシグナリングサーバー経由でオンラインかをチェック
        const isOnline = (peers[friend.id] && peers[friend.id].connectionState === 'connected') || onlineFriendsCache.has(friend.id);

        // 無料期間（追加から30日以内）かどうかを判定
        const addedDate = friend.added ? new Date(friend.added) : null;
        const now = new Date();
        const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;
        const isInFreeTrial = addedDate && (now - addedDate) < thirtyDaysInMillis;

        // 課金ユーザー、または無料期間中であれば足跡機能が有効
        const canShowFootprints = isSubscribed || isInFreeTrial;
        const hadOfflineActivity = canShowFootprints && offlineActivityCache.has(friend.id) && !isOnline;
        displaySingleFriend(friend, isOnline, hadOfflineActivity, canShowFootprints, isInFreeTrial);
    });
    updateOnlineFriendsSelector();
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
  } catch (error) {
  }
}
async function displayStoredMails() {
  if (!dbPromise || !messageAreaElement) return;
  try {
    const db = await dbPromise;
    const mails = await db.getAll('mails');
    mails.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    mails.forEach(mail => displayMailMessage(mail));
  } catch (error) {
    console.error("Error displaying stored mails:", error);
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
function displaySingleFriend(friend, isOnline, hadOfflineActivity, canShowFootprints, isInFreeTrial) {
    if (!friendListElement) return;
    const div = document.createElement('div');
    const lang = getLang();
    div.className = 'friend-item';
    div.dataset.friendId = friend.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'friend-id';

    // hadOfflineActivity は「不在時にオンラインだった」ことを示すフラグ。
    // isOnline が true の場合は、現在オンラインなので通常の緑表示を優先する。
    // したがって、hadOfflineActivity が true かつ isOnline が false の場合にのみ紫表示とする。
    if (canShowFootprints && hadOfflineActivity && !isOnline) { // 足跡機能が有効なユーザーで、不在時アクティビティがある場合に紫色
        nameSpan.style.color = 'purple'; // 不在時にオンラインだった友達
        let statusText = i18n[lang].wasOnline;
        // 課金しておらず、無料期間中の場合に注釈を追加
        if (!isSubscribed && isInFreeTrial) {
            statusText += ` (${i18n[lang].freeTrial})`;
        }
        const lastSeenText = friend.lastSeen ? `${i18n[lang].lastSeen}: ${new Date(friend.lastSeen).toLocaleString()}` : i18n[lang].offline;
        nameSpan.textContent = `ID: ${friend.id.substring(0, 8)}... (${statusText} - ${lastSeenText})`;
    } else if (isOnline) {
        nameSpan.style.color = 'green';
        const lastSeen = friend.lastSeen ? new Date(friend.lastSeen).toLocaleString() : i18n[lang].justNow;
        nameSpan.textContent = `ID: ${friend.id.substring(0, 8)}... (${i18n[lang].onlineSince}: ${lastSeen})`;
    } else {
        nameSpan.style.color = 'inherit'; // オフラインの友達
        const lastSeenText = friend.lastSeen ? `${i18n[lang].lastSeen}: ${new Date(friend.lastSeen).toLocaleString()}` : i18n[lang].offline;
        nameSpan.textContent = `ID: ${friend.id.substring(0, 8)}... (${lastSeenText})`;
    }

    const callFriendButton = document.createElement('button');
    callFriendButton.textContent = `📞 ${i18n[lang].call}`;
    callFriendButton.className = 'call-friend-button';
    callFriendButton.dataset.friendId = friend.id;
    // 修正: handleCallFriendClick の代わりに toggleVideoCall を直接呼び出す
    callFriendButton.addEventListener('click', async (event) => {
        const friendId = event.target.dataset.friendId;
        if (friendId) {
            await toggleAudioCall(friendId);
        }
    });
    callFriendButton.disabled = !isOnline;

    const mailButton = document.createElement('button');
    mailButton.textContent = `✉`;
    mailButton.className = 'mail-friend-button';
    mailButton.title = i18n[lang].mail;
    mailButton.style.marginLeft = '5px';
    mailButton.onclick = () => openMailModal(friend.id);

    if (!canShowFootprints) {
        mailButton.disabled = true;
        mailButton.style.opacity = '0.5';
    }

    div.appendChild(nameSpan);
    div.appendChild(callFriendButton);
    div.appendChild(mailButton);
    friendListElement.appendChild(div);
}

function updateOnlineFriendsSelector() {
    if (!onlineFriendSelector) return;

    const currentlySelected = onlineFriendSelector.value;
    onlineFriendSelector.innerHTML = '<option value="">-- Select a friend --</option>';

    const onlinePeers = Object.keys(peers).filter(id => peers[id] && peers[id].connectionState === 'connected');

    onlinePeers.forEach(peerId => {
        const option = document.createElement('option');
        option.value = peerId;
        option.textContent = `Peer (${peerId.substring(0, 6)})`;
        onlineFriendSelector.appendChild(option);
    });

    // 以前選択されていた相手がまだオンラインなら、再度選択状態にする
    if (onlinePeers.includes(currentlySelected)) {
        onlineFriendSelector.value = currentlySelected;
    }
}
async function connectWebSocket() {
  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
    return;
  }
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${location.host}/ws/signaling/`;
  updateStatus('Connecting to signaling server...', 'blue');
  signalingSocket = new WebSocket(wsUrl); // WebSocketインスタンスを再作成
  signalingSocket.onopen = async () => { // asyncキーワードを追加
    wsReconnectAttempts = 0;
    isAttemptingReconnect = false;
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }

    // --- 友達リストを取得してregisterメッセージに含める ---
    const db = await dbPromise;
    const friends = await db.getAll('friends');
    const friendIds = friends.map(f => f.id);

    updateStatus(`Connected to signaling server. Registering (Subscribed: ${isSubscribed})...`, 'blue');
    sendSignalingMessage({
      type: 'register',
      payload: { 
          uuid: myDeviceId,
          friends: friendIds, // 友達リスト
          is_subscribed: isSubscribed // 課金状態を送信
      }
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
            // isSubscribed はページ読み込み時にAPIから取得するため、ここでは何もしない
            // サーバーからの通知（不在着信や友達のオンライン通知）を処理する
            offlineActivityCache.clear(); // 新しい通知を受け取る前にキャッシュをクリア
            console.log("[DEBUG] Registered payload:", payload);
            if (payload.notifications && Array.isArray(payload.notifications)) {
                console.log("[DEBUG] Notifications:", payload.notifications);
                for (const notification of payload.notifications) {
                    if (notification.type === 'missed_call') {
                        displayMissedCallNotification(notification.sender, notification.timestamp);
                    } else if (notification.type === 'friend_online') {
                        // 課金ユーザー、または無料期間中のユーザーのみが不在時アクティビティ通知を処理する
                        const db = await dbPromise;
                        const friend = await db.get('friends', notification.sender);
                        let isInFreeTrial = false;
                        if (friend && friend.added) {
                            const addedDate = new Date(friend.added);
                            const now = new Date();
                            const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;
                            isInFreeTrial = (now - addedDate) < thirtyDaysInMillis;
                        }

                        const canProcessNotification = isSubscribed || isInFreeTrial;

                        if (canProcessNotification) {
                            // 友達の最終ログイン日時を更新し、不在時活動キャッシュに追加
                            await updateFriendLastSeen(notification.sender, notification.timestamp);
                            offlineActivityCache.add(notification.sender);
                            let statusMessage = `Friend ${notification.sender.substring(0,6)} was online at ${new Date(notification.timestamp).toLocaleTimeString()}`;
                            if (!isSubscribed && isInFreeTrial) {
                                const lang = getLang();
                                statusMessage += ` (${i18n[lang].freeTrial})`;
                            }
                            updateStatus(statusMessage, 'purple');
                        }
                    } else if (notification.type === 'new_mail_notification') { // 変更: 'mail' から 'new_mail_notification' へ
                        const mail = notification.payload || notification;
                        // サーバーからの通知形式によってsenderやidの場所が異なる場合に対応
                        if (!mail.sender && notification.sender) {
                            mail.sender = notification.sender;
                        }
                        if (!mail.sender) continue;
                        if (!mail.id) {
                            mail.id = notification.id || generateUUID();
                        }
                        if (!mail.timestamp && notification.timestamp) {
                            mail.timestamp = notification.timestamp;
                        }

                        let db = null;
                        if (dbPromise) {
                            try { db = await dbPromise; } catch (e) {}
                        }
                        let isInFreeTrial = true;
                        if (db) {
                            const friend = await db.get('friends', mail.sender);
                            if (friend) {
                                const addedDate = friend.added ? new Date(friend.added) : new Date();
                                const now = new Date();
                                const thirtyDaysInMillis = 30 * 24 * 60 * 60 * 1000;
                                isInFreeTrial = (now - addedDate) < thirtyDaysInMillis;
                            }
                        }

                        const canProcessNotification = isSubscribed || isInFreeTrial;

                        if (canProcessNotification) {
                            if (db) {
                                try {
                                    await db.put('mails', mail);
                                } catch (e) {
                                    // ここではDBに保存しない。クリック時に保存する
                                }
                            }
                            displayNewMailNotification(mail); // 変更: 直接表示せず、通知を表示
                            if (document.visibilityState === 'visible') {
                                playNotificationSound();
                            }
                        }
                    }
                }
            }

            updateStatus('Connected to signaling server. Ready.', 'green');
            currentAppState = AppState.INITIAL;
            setInteractionUiEnabled(false);
            await Promise.all([displayFriendList(), displayStoredMails()]);
            // 友達との自動接続を開始する
            startAutoConnectFriendsTimer();
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
                const friendExists = await isFriend(joinedUUID);
                if (friendExists) {
                    onlineFriendsCache.add(joinedUUID);
                    await updateFriendLastSeen(joinedUUID, new Date()); // 最終ログイン時間を現在時刻で更新
                    await displayFriendList();
                    // アプリがフォアグラウンドの場合に音を鳴らす
                    if (document.visibilityState === 'visible') {
                        playNotificationSound();
                    }
                    // 既存の接続があれば一度閉じてから再接続を試みる。
                    // close処理が完了するのを待つために、わずかな遅延を入れる。
                    if (peers[joinedUUID]) {
                        closePeerConnection(joinedUUID, true); // silent close
                        // 接続のクリーンアップ時間を確保するためにsetTimeoutを使用
                        setTimeout(() => {
                            createOfferForPeer(joinedUUID);
                        }, 100); // 100msの遅延
                    } else {
                        // 友達なので接続を開始する
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
            if (senderUUID) {
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
        case 'new_mail_notification': // 変更: 'mail' から 'new_mail_notification' へ
             console.log("[DEBUG] Realtime new mail notification received:", payload);
             if (payload && payload.sender && payload.sender !== myDeviceId) {
                 displayNewMailNotification(payload);
                 if (document.visibilityState === 'visible') {
                    playNotificationSound();
                 }
             }
            break;
      }
    } catch (error) {
    }
  };
  signalingSocket.onclose = async (event) => {
    // 接続が意図せず切れた場合のみ再接続を試みる
    // 1000 (Normal Closure) や 1001 (Going Away) はユーザーがページを離れた場合など。
    if (event.code !== 1000 && event.code !== 1001) {
        handleWebSocketReconnect();
    } else {
        updateStatus('Signaling connection closed.', 'orange');
    }
    // 全てのピア接続をリセットする
    Object.keys(peers).forEach(peerUUID => closePeerConnection(peerUUID, true)); // silent close
    peers = {};
    signalingSocket = null;
    await displayFriendList();
  };
  signalingSocket.onerror = (error) => {
    updateStatus('Signaling socket error.', 'red');
    console.error("WebSocket Error:", error);
    // onerrorの後には通常oncloseが呼ばれるので、再接続処理はoncloseに任せる
    if (signalingSocket && (signalingSocket.readyState === WebSocket.OPEN || signalingSocket.readyState === WebSocket.CONNECTING)) {
        signalingSocket.close();
    }
  };
}

function handleWebSocketReconnect() {
    if (isAttemptingReconnect) return; // 既に再接続処理中なら何もしない

    isAttemptingReconnect = true;
    wsReconnectAttempts = 0;
    
    const attemptReconnect = () => {
      if (wsReconnectAttempts >= MAX_WS_RECONNECT_ATTEMPTS) {
          updateStatus('Could not reconnect to signaling server. Please check your connection and refresh.', 'red');
          isAttemptingReconnect = false;
          return;
      }

      wsReconnectAttempts++;
      let delay = INITIAL_WS_RECONNECT_DELAY_MS * Math.pow(1.5, wsReconnectAttempts - 1);
      delay = Math.min(delay, MAX_WS_RECONNECT_DELAY_MS);
      updateStatus(`Signaling disconnected. Reconnecting in ${Math.round(delay/1000)}s (Attempt ${wsReconnectAttempts}/${MAX_WS_RECONNECT_ATTEMPTS})...`, 'orange');
      Object.keys(peers).forEach(peerUUID => closePeerConnection(peerUUID));
      Object.values(dataChannels).forEach(channel => { if (channel && channel.readyState !== 'closed') channel.close(); });
      dataChannels = {};

      if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
      wsReconnectTimer = setTimeout(async () => {
          await connectWebSocket();
          // connectWebSocketが成功すれば onopen で isAttemptingReconnect は false になる
      }, delay);
    };
    attemptReconnect();
}
function sendSignalingMessage(message) {
  if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
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
          // 接続が確立したら、不在時アクティビティのキャッシュをクリアしてリストを再描画
          offlineActivityCache.delete(peerUUID);
          await displayFriendList();
          updateOnlineFriendsSelector();

          const connectedPeers = Object.values(peers).filter(p => p?.connectionState === 'connected');
          if (connectedPeers.length > 0 && (messageInputElement && !messageInputElement.disabled)) {
          } else if (connectedPeers.length > 0) {
              setInteractionUiEnabled(true);
              currentAppState = AppState.CONNECTED;
          }
          break;
        case 'failed':
          updateStatus(`Connection with ${peerUUID.substring(0,6)} failed. Attempting to reconnect...`, 'orange');
          clearNegotiationTimeout(peerUUID);
          // 接続が 'failed' になった場合にのみ、積極的に再接続を開始する
          if (await isFriend(peerUUID) && (!peerReconnectInfo[peerUUID] || !peerReconnectInfo[peerUUID].isReconnecting)) {
            if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
                 startPeerReconnect(peerUUID);
            } else {
                 closePeerConnection(peerUUID); // WSがなければ諦める
            }
          }
          break;
        case 'disconnected':
          updateStatus(`Connection with ${peerUUID.substring(0,6)} disconnected.`, 'orange');
          clearNegotiationTimeout(peerUUID);
          // 'disconnected' は一時的な場合があるため、すぐに再接続せず、ブラウザの回復や次の自動接続試行に任せる
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
          updateOnlineFriendsSelector();
          updateOnlineFriendsSelector();
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
        // データチャネルのエラーで即座に接続を切断せず、ログに記録するだけにする。
        // 接続状態の変更は onconnectionstatechange に任せる。
        console.error(`Data channel error for ${peerUUID}:`, error);
        updateStatus(`Data channel error with ${peerUUID.substring(0,6)}. Connection may be unstable.`, 'red');
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
             updateOnlineFriendsSelector();
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
                    type: message.fileType,
                    isBroadcast: message.isBroadcast
                };
                receivedSize[message.fileId] = 0;
                const statusElement = message.isBroadcast ? groupFileTransferStatusElement : directFileTransferStatusElement;
                if (statusElement) {
                    statusElement.textContent = `Receiving ${message.name}... 0%`;
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
    const fileInfo = incomingFileInfo[fileId];
    if (!fileInfo) {
      console.error(`Received chunk data for unknown file transfer (no metadata): ${fileId} from ${senderUUID}`);
        return;
    }

    const statusElement = fileInfo.isBroadcast ? groupFileTransferStatusElement : directFileTransferStatusElement;
    const targetArea = fileInfo.isBroadcast ? postAreaElement : messageAreaElement;

    let db;
    try {
        if (!(chunkDataAsArrayBuffer instanceof ArrayBuffer)) {
            await cleanupFileTransferData(fileId, null);
            return;
        }
        if (!dbPromise) {
            if (statusElement) statusElement.innerHTML = DOMPurify.sanitize(`DB Error for ${fileInfo.name || 'file'}`);
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
        const progress = Math.round((receivedSize[fileId] / fileInfo.size) * 100);
        if (statusElement) {
          statusElement.innerHTML = DOMPurify.sanitize(`Receiving ${fileInfo.name}... ${progress}%`);
        }
        if (isLast) {
            if (receivedSize[fileId] !== fileInfo.size) {
                if (statusElement) statusElement.innerHTML = DOMPurify.sanitize(`Error assembling ${fileInfo.name} (final size error)`);
                await cleanupFileTransferData(fileId, db);
                return;
            }
            allChunksForFileFromDb.sort((a, b) => a.chunkIndex - b.chunkIndex);
            if (allChunksForFileFromDb.length !== chunkIndex + 1) {
                 console.warn(`Missing chunks for file ${fileId}. Expected ${chunkIndex + 1}, got ${allChunksForFileFromDb.length} from DB. Cannot assemble.`);
                 if (statusElement) statusElement.innerHTML = DOMPurify.sanitize(`Error receiving ${fileInfo.name} (missing chunks from DB)`);
                 await cleanupFileTransferData(fileId, db);
                 return;
            }
            const orderedChunkData = allChunksForFileFromDb.map(c => c.data);
            const fileBlob = new Blob(orderedChunkData, { type: fileInfo.type });

            const downloadContainer = document.createElement('div');
            downloadContainer.className = 'message peer-message';

            const senderName = `File from ${senderUUID.substring(0, 6)}`;
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(fileBlob);
            downloadLink.download = fileInfo.name;
            downloadLink.textContent = `Download ${fileInfo.name}`;

            downloadContainer.innerHTML = DOMPurify.sanitize(`<strong>${senderName}:</strong> `);
            downloadContainer.appendChild(downloadLink);

            if (statusElement) statusElement.innerHTML = '';
            targetArea.appendChild(downloadContainer);
            targetArea.scrollTop = targetArea.scrollHeight;

            await cleanupFileTransferData(fileId, db, true);
        }
    } catch (error) {
    if (statusElement) statusElement.innerHTML = DOMPurify.sanitize(`Error processing chunk for ${fileInfo?.name || 'unknown file'}`);
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

function sendPrivateMessage(targetPeerUUID, messageString) {
    if (!targetPeerUUID) {
        alert("Please select a friend to chat with.");
        return false;
    }
    const channel = dataChannels[targetPeerUUID];
    if (channel && channel.readyState === 'open') {
        try {
            channel.send(messageString);
            return true;
        } catch (error) {
            console.error(`Error sending private message to ${targetPeerUUID}:`, error);
            return false;
        }
    }
    return false;
}
function sendPrivateBinaryData(targetPeerUUID, dataBuffer) {
    const channel = dataChannels[targetPeerUUID];
    if (channel && channel.readyState === 'open') {
        try {
            channel.send(dataBuffer);
            return true;
        } catch (error) {
            console.error(`Error sending binary data to ${targetPeerUUID}:`, error);
            return false;
        }
    }
    return false;
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
        // 修正：選択された相手にのみ送信
        if (sendPrivateMessage(selectedPeerId, messageString)) {
            displayDirectMessage(message, true);
            if(input) input.value = '';
        } else {
            alert(`Could not send message. Please select an online friend and ensure you are connected.`);
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
function displayMailMessage(mail) {
    if (!messageAreaElement || !mail || !mail.sender) return;
    
    // 重複表示を防ぐ
    const existingElement = document.getElementById(`mail-${mail.id}`);
    if (existingElement) return;

    const div = document.createElement('div');
    div.id = `mail-${mail.id}`; // IDを付与して重複チェック可能にする
    
    const isOwn = mail.sender === myDeviceId;
    div.className = isOwn ? 'message own-message' : 'message peer-message';
    div.style.border = '2px solid purple';
    div.style.backgroundColor = '#f9f0ff';

    let senderName = `✉ Mail from ${mail.sender.substring(0, 6)}`;
    if (isOwn) {
        senderName = `✉ Mail to ${mail.target ? mail.target.substring(0, 6) : 'Peer'}`;
    }

    const linkedContent = linkify(mail.content);
    let html = `<strong>${senderName}:</strong><br>${linkedContent}`;

    if (mail.nextAccess) {
        const dateStr = new Date(mail.nextAccess).toLocaleString();
        html += `<br><small style="color:purple">📅 ${i18n[getLang()].nextAccess}: ${dateStr}</small>`;
    }
    div.innerHTML = DOMPurify.sanitize(html);
    messageAreaElement.appendChild(div);
    messageAreaElement.scrollTop = messageAreaElement.scrollHeight;
}

function displayNewMailNotification(notification) {
    if (!messageAreaElement || !notification || !notification.mail_id) return;
    const lang = getLang();

    // 既に同じ通知やメール本体が表示されていないか確認
    if (document.getElementById(`mail-notification-${notification.mail_id}`) || document.getElementById(`mail-${notification.mail_id}`)) {
        return;
    }

    const div = document.createElement('div');
    div.id = `mail-notification-${notification.mail_id}`;
    div.className = 'message peer-message mail-notification';
    div.style.border = '2px solid purple';
    div.style.backgroundColor = '#f9f0ff';
    div.style.cursor = 'pointer';

    const senderName = notification.sender ? notification.sender.substring(0, 6) : 'Unknown';
    div.innerHTML = DOMPurify.sanitize(`<strong>✉ ${i18n[lang].newMailNotification} ${senderName}</strong><br><em>${i18n[lang].clickToView}</em>`);

    div.onclick = () => fetchAndDisplayMail(notification.mail_id);

    messageAreaElement.appendChild(div);
    messageAreaElement.scrollTop = messageAreaElement.scrollHeight;
    updateStatus(`${i18n[lang].newMailNotification} ${senderName}`, 'purple');
}

async function fetchAndDisplayMail(mailId) {
    if (!mailId) return;
    const notificationElement = document.getElementById(`mail-notification-${mailId}`);
    if (notificationElement) {
        notificationElement.style.cursor = 'default';
        notificationElement.onclick = null;
        notificationElement.innerHTML = '<em>Loading mail...</em>';
    }

    try {
        // このAPIはサーバー側で実装する必要があります
        const response = await fetch(`/api/mails/get/${mailId}/`);
        if (!response.ok) {
            throw new Error('Failed to fetch mail from server.');
        }
        const mail = await response.json();

        if (dbPromise) {
            const db = await dbPromise;
            await db.put('mails', mail);
        }

        // 通知メッセージを実際のメール内容に置き換える（一度削除してから再描画）
        if (notificationElement) notificationElement.remove();
        displayMailMessage(mail);

    } catch (error) {
        console.error("Error fetching mail:", error);
        if (notificationElement) {
            notificationElement.innerHTML = `<em style="color:red;">Failed to load mail.</em>`;
        }
        updateStatus('Failed to load mail.', 'red');
    }
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
function handleDirectSendFile() {
    performFileTransfer(false);
}

function handleGroupSendFile() {
    performFileTransfer(true);
}

function performFileTransfer(isBroadcast) {
    const fileInput = isBroadcast ? groupFileInputElement : directFileInputElement;
    const statusElement = isBroadcast ? groupFileTransferStatusElement : directFileTransferStatusElement;
    const sendButton = isBroadcast ? sendGroupFileButton : sendDirectFileButton;
    const targetPeerId = isBroadcast ? null : selectedPeerId;

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert("Please select a file.");
        return;
    }
    if (!isBroadcast && !targetPeerId) {
        alert("Please select a friend to send the file to.");
        return;
    }

    const file = fileInput.files[0];
    const snapshottedFileSize = file.size;
    const fileId = generateUUID();
    if (statusElement) statusElement.innerHTML = DOMPurify.sanitize(`Sending ${file.name}... 0%`);
    sendButton.disabled = true;
    const metadata = {
        type: 'file-metadata',
        fileId: fileId,
        name: file.name,
        size: snapshottedFileSize,
        fileType: file.type,
        isBroadcast: isBroadcast
    };
    const metadataString = JSON.stringify(metadata);

    let metaSent = false;
    if (isBroadcast) {
        metaSent = broadcastMessage(metadataString);
    } else {
        metaSent = sendPrivateMessage(targetPeerId, metadataString);
    }

    if (!metaSent) {
        const msg = isBroadcast ? "Failed to send file metadata to any peer." : `Failed to send file metadata to ${targetPeerId.substring(0,6)}.`;
        alert(msg);
        sendButton.disabled = false;
        return;
    }

    // Use local FileReader to avoid conflicts if multiple transfers happen
    const reader = new FileReader();
    let offset = 0;
    let chunkIndex = 0;

    reader.addEventListener('error', error => {
        console.error('FileReader error:', error);
        alert('File read error occurred.');
        if (statusElement) statusElement.innerHTML = DOMPurify.sanitize('File read error');
        sendButton.disabled = false;
    });
    reader.addEventListener('abort', event => {
        console.log('FileReader abort:', event);
        if (statusElement) statusElement.innerHTML = DOMPurify.sanitize('File send aborted');
        sendButton.disabled = false;
    });
    reader.addEventListener('load', e => {
        const chunkArrayBuffer = e.target.result;
        
        // Flow control check
        let canSend = false;
        if (isBroadcast) {
            // For broadcast, we check if at least one channel is open. 
            // Flow control for broadcast is tricky; we'll skip complex bufferedAmount checks for simplicity or check all.
            // Here we just check if we have open channels.
            const openChannels = Object.values(dataChannels).filter(dc => dc && dc.readyState === 'open');
            canSend = openChannels.length > 0;
        } else {
            const channel = dataChannels[targetPeerId];
            if (channel && channel.readyState === 'open') {
                // Simple flow control
                if ((channel.bufferedAmount || 0) > CHUNK_SIZE * 16) {
                    setTimeout(() => {
                        sendFileChunk(chunkArrayBuffer, file.name, snapshottedFileSize, fileId, chunkIndex, offset);
                    }, 200);
                    return;
                }
                canSend = true;
            }
        }

        if (!canSend) {
            console.warn("Channel closed or unavailable during file send.");
            if (statusElement) statusElement.innerHTML = DOMPurify.sanitize('Connection lost during send');
            sendButton.disabled = false;
            return;
        }
        sendFileChunk(chunkArrayBuffer, file.name, snapshottedFileSize, fileId, chunkIndex, offset);
    });
    const readSlice = o => {
        try {
            const end = Math.min(o + CHUNK_SIZE, snapshottedFileSize);
            const slice = file.slice(o, end);
            reader.readAsArrayBuffer(slice);
        } catch (readError) {
             console.error('Error reading file slice:', readError);
             alert('Failed to read file slice.');
             if (statusElement) statusElement.textContent = 'File slice error';
             sendButton.disabled = false;
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
             
             let metaSent = false;
             if (isBroadcast) metaSent = broadcastMessage(metaString);
             else metaSent = sendPrivateMessage(targetPeerId, metaString);

             if (!metaSent) {
                 if (retryCount < 3) throw new Error(`Failed to send chunk meta ${currentChunkIndex}.`);
                 else {
                    console.error(`Failed to send chunk meta ${currentChunkIndex} after multiple retries.`);
                 }
             }
             setTimeout(() => {
                let dataSent = false;
                if (isBroadcast) dataSent = broadcastBinaryData(chunkDataAsArrayBuffer);
                else dataSent = sendPrivateBinaryData(targetPeerId, chunkDataAsArrayBuffer);

                if (!dataSent) {
                    if (retryCount < 3) throw new Error(`Failed to send chunk data ${currentChunkIndex}.`);
                 else {
                    console.error(`Failed to send chunk data ${currentChunkIndex} after multiple retries.`);
                 }
             }
             const newOffset = currentOffset + chunkDataAsArrayBuffer.byteLength;
             const progress = Math.round((newOffset / originalFileSizeInLogic) * 100);
             if (statusElement) statusElement.textContent = `Sending ${originalFileName}... ${progress}%`;
             if (newOffset < originalFileSizeInLogic) {
                offset = newOffset;
                 chunkIndex++;
                 setTimeout(() => readSlice(newOffset), 0);
             } else {
                 if (statusElement) statusElement.innerHTML = DOMPurify.sanitize(`Sent ${originalFileName}`);
                 if(fileInput) fileInput.value = '';
                 sendButton.disabled = false;
             }
            }, 10);
        } catch (error) {
             console.error(`Error sending chunk ${currentChunkIndex}:`, error);
             if (retryCount < 3) {
                 setTimeout(() => sendFileChunk(chunkDataAsArrayBuffer, originalFileName, originalFileSizeInLogic, currentFileId, currentChunkIndex, currentOffset, retryCount + 1), 1000 * (retryCount + 1));
             } else {
                 alert(`Failed to send chunk ${currentChunkIndex} after multiple retries.`);
                 if (statusElement) statusElement.innerHTML = DOMPurify.sanitize('Chunk send error');
                 await cleanupFileTransferData(currentFileId, await dbPromise);
                 sendButton.disabled = false;
             }
         }
    }
    readSlice(0);
}
async function toggleAudioCall(targetPeerUUID) {
    // ターゲットとのP2P接続がなければ、まず接続を試みる
    if (!peers[targetPeerUUID] || peers[targetPeerUUID].connectionState !== 'connected') {
        updateStatus(`Connecting to ${targetPeerUUID.substring(0, 6)} for an audio call...`, 'blue');
        await createOfferForPeer(targetPeerUUID);
        // 接続が確立するのを少し待つ
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!peers[targetPeerUUID] || peers[targetPeerUUID].connectionState !== 'connected') {
            updateStatus(`Failed to connect to ${targetPeerUUID.substring(0, 6)}. Please try again.`, 'red');
            return;
        }
    }

    const peer = peers[targetPeerUUID];
    if (!peer) return;

    // 既に音声トラックを送信しているかチェック
    const audioSender = peer.getSenders().find(s => s.track && s.track.kind === 'audio');

    if (audioSender) {
        // 通話終了：トラックを削除し、再ネゴシエーション
        updateStatus(`Ending audio call with ${targetPeerUUID.substring(0, 6)}.`, 'orange');
        peer.removeTrack(audioSender);
        if (localStream) { // 他の通話で使っている可能性も考慮
            audioSender.track.stop();
            // もしこの音声トラックがローカルストリームの最後のトラックなら、ストリーム自体をクリア
            if (localStream.getTracks().length === 0) {
                localStream = null;
            }
        }
        await createAndSendOfferForRenegotiation(targetPeerUUID, peer);
    } else {
        // 通話開始：音声ストリームを取得し、トラックを追加して再ネゴシエーション
        try {
            updateStatus(`Starting audio call with ${targetPeerUUID.substring(0, 6)}...`, 'blue');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            if (!localStream) localStream = new MediaStream();
            stream.getAudioTracks().forEach(track => {
                localStream.addTrack(track);
                peer.addTrack(track, localStream);
            });
            await createAndSendOfferForRenegotiation(targetPeerUUID, peer);
        } catch (error) {
            alert(`Could not start audio call: ${error.message}`);
        }
    }
}
async function toggleVideoCall(targetPeerUUID = null) {
    // 接続中のピアがいない場合は何もしない
    const connectedPeers = Object.values(peers).filter(p => p && p.connectionState === 'connected');
    if (connectedPeers.length === 0 && !localStream) {
        alert("No one is connected for a video meeting.");
        return;
    }

    if (!localStream) {
        // ビデオ会議を開始
        try {
            // 音声のみでストリームを開始
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            if (localVideoElement) {
                localVideoElement.srcObject = localStream;
                localVideoElement.style.display = 'block'; // 音声のみでも表示エリアは確保
            }
            // ピアに音声トラックを送信
            await addTrackToAllPeers(localStream.getAudioTracks()[0]);

            if(callButton) callButton.textContent = 'End Call';
            if(frontCamButton) frontCamButton.style.display = 'inline-block';
            if(backCamButton) backCamButton.style.display = 'inline-block';
            updateStatus('Video meeting started (Audio only).', 'green');
        } catch (error) {
            alert(`Media access error: ${error.message}`);
            localStream = null;
        }
    } else {
        // ビデオ会議を終了
        localStream.getTracks().forEach(track => track.stop());
        localStream = null; // ストリームをクリア
        // 全てのピアからトラックを削除するシグナリング（再ネゴシエーション）
        await removeAllTracksFromAllPeers();

        if(localVideoElement) localVideoElement.srcObject = null;
        if(callButton) callButton.textContent = '📞';
        if(frontCamButton) frontCamButton.style.display = 'none';
        if(backCamButton) backCamButton.style.display = 'none';
        updateStatus('Video meeting ended.', 'orange');
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

async function handleVideoButtonClick(facingMode) {
    if (!localStream) {
        alert("Please start a meeting first (click 📞).");
        return;
    }
    const videoTrack = localStream.getVideoTracks()[0];

    if (videoTrack) {
        // ビデオが既にオンの場合、オフにする
        await removeVideo();
    } else {
        // ビデオがオフの場合、指定されたカメラでオンにする
        await addVideo(facingMode);
    }
}

async function addVideo(facingMode) {
    if (!localStream) return;
    // 既にビデオトラックがあれば何もしない
    if (localStream.getVideoTracks().length > 0) {
        updateStatus('Video is already on.', 'orange');
        return;
    }

    try {
        updateStatus(`Starting ${facingMode} camera...`, 'blue');
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode } });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        localStream.addTrack(newVideoTrack);
        if (localVideoElement) localVideoElement.srcObject = localStream;

        // 全てのピアに新しいビデオトラックを追加
        await addTrackToAllPeers(newVideoTrack);

        currentFacingMode = facingMode;
        updateStatus(`Video added with ${facingMode} camera.`, 'green');
    } catch (error) {
        console.error(`Error adding video: ${error}`);
        updateStatus(`Could not start camera: ${error.message}`, 'red');
    }
}

async function removeVideo() {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
        updateStatus('Stopping video...', 'orange');
        videoTrack.stop();
        localStream.removeTrack(videoTrack);
        if (localVideoElement) localVideoElement.srcObject = localStream;

        // 全てのピアからビデオトラックを削除
        await removeTrackFromAllPeers(videoTrack);

        updateStatus('Video stopped.', 'blue');
    } catch (error) {
        console.error(`Error removing video: ${error}`);
    }
}

async function addTrackToAllPeers(track) {
    const renegotiationPromises = Object.entries(peers).map(async ([peerUUID, peer]) => {
        if (peer && peer.connectionState === 'connected') {
            peer.addTrack(track, localStream);
            await createAndSendOfferForRenegotiation(peerUUID, peer);
        }
    });
    await Promise.all(renegotiationPromises);
}

async function removeTrackFromAllPeers(track) {
    const renegotiationPromises = Object.entries(peers).map(async ([peerUUID, peer]) => {
        if (peer && peer.connectionState === 'connected') {
            const sender = peer.getSenders().find(s => s.track === track);
            if (sender) {
                peer.removeTrack(sender);
                await createAndSendOfferForRenegotiation(peerUUID, peer);
            }
        }
    });
    await Promise.all(renegotiationPromises);
}

async function removeAllTracksFromAllPeers() {
    const renegotiationPromises = Object.entries(peers).map(async ([peerUUID, peer]) => {
        if (peer) {
            peer.getSenders().forEach(sender => peer.removeTrack(sender));
            await createAndSendOfferForRenegotiation(peerUUID, peer);
        }
    });
    await Promise.all(renegotiationPromises);
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
    // スキャン中でなければ、指定されたカメラでスキャンを開始する
    if (!isScanning) {
        startQrScanner();
    } else {
        stopQrScanner();
    }
}

async function startQrScanner() {
    if (isScanning) return; // 既にスキャン中なら何もしない

    if (!qrReaderElement || typeof Html5Qrcode === 'undefined') {
        updateStatus('QR Scanner library not loaded yet.', 'orange');
        return;
    }

    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }

    try {
        if(startScanButton) {
            startScanButton.textContent = 'Starting...';
            startScanButton.disabled = true;
        }
        qrReaderElement.style.display = 'block';
        updateStatus('Starting QR Scanner...', 'blue');

        await html5QrCode.start(
            { facingMode: "environment" }, // 背面カメラを使用
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText, decodedResult) => {
                updateStatus('QR Scan successful. Processing...', 'blue');
                handleScannedQrData(decodedText);
                stopQrScanner(); // スキャン成功後、自動で停止
            },
            (errorMessage) => { /* QRコードが見つからない場合は何もしない */ }
        );

        isScanning = true;
        updateStatus('QR Scanner started.', 'blue');
        if(startScanButton) {
            startScanButton.textContent = 'Stop Scan';
            startScanButton.disabled = false;
        }
    } catch (err) {
        updateStatus(`QR Scanner Error: ${err}`, 'red');
        if(qrReaderElement) qrReaderElement.style.display = 'none';
        if(startScanButton) {
            startScanButton.textContent = 'Scan QR Code';
            startScanButton.disabled = false;
        }
        isScanning = false; // 状態をリセット
    }
}

async function stopQrScanner() {
    if (!isScanning || !html5QrCode) return;

    try {
        await html5QrCode.stop();
        updateStatus('QR Scanner stopped.', 'blue');
    } catch (err) {
        console.error("Error stopping QR scanner:", err);
    } finally {
        isScanning = false;
        if(qrReaderElement) qrReaderElement.style.display = 'none';
        if(startScanButton) {
            startScanButton.textContent = 'Scan QR Code';
            startScanButton.disabled = false;
        }
    }
}
async function handleScannedQrData(decodedText) {
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

function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

// app.js のどこか（例: DOMContentLoaded の最後の方）に追加

async function subscribeToPushNotifications() {
    if (!('PushManager' in window) || !('serviceWorker' in navigator)) {
        console.warn('Push messaging is not supported');
        return;
    }

    const registration = await navigator.serviceWorker.ready;
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') {
        updateStatus('Push notification permission not granted.', 'orange');
        return;
    }

    // サーバーからVAPID公開鍵を取得するAPIを呼び出す（別途実装が必要）
    const response = await fetch('/api/get_vapid_public_key/'); 
    const data = await response.json();
    const vapidPublicKey = data.publicKey;

    const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey
    });

    // 購読情報をサーバーに送信して保存するAPIを呼び出す（別途実装が必要）
    await fetch('/api/save_push_subscription/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({ subscription: subscription, user_id: myDeviceId })
    });
    updateStatus('Subscribed to push notifications!', 'green');
}

// 適切なタイミングで呼び出す。例：ボタンクリック時や、初回アクセス時など。
// subscribeToPushNotifications();


// 適切なタイミングで呼び出す。例：ボタンクリック時や、初回アクセス時など。
let unreadCount = 0;

function displayMissedCallNotification(senderId, timestamp) {
    if (!statusElement) return;
    const lang = getLang();
    const date = new Date(timestamp);
    const timeString = date.toLocaleTimeString();
    const message = `📞 ${i18n[lang].missedCallFrom} ${senderId.substring(0, 6)} ${i18n[lang].at} ${timeString}`;
    // updateStatus を使って、他のステータスメッセージと同様に表示する
    updateStatus(message, 'purple'); // 紫色などで目立たせる

    // --- バッジ機能の追加 ---
    if ('setAppBadge' in navigator) {
        unreadCount++;
        navigator.setAppBadge(unreadCount).catch(error => {
            console.error('Failed to set app badge:', error);
        });
    }
}

function setupEventListeners() {
    const enableNotificationsButton = document.getElementById('enableNotificationsButton');
    enableNotificationsButton?.addEventListener('click', subscribeToPushNotifications);

    const subscribeButton = document.getElementById('subscribeButton');
    subscribeButton?.addEventListener('click', handleSubscribeClick);

    window.addEventListener('resize', () => {
        if (qrElement && qrElement.style.display !== 'none') {
            const myAppUrl = window.location.origin + '/?id=' + myDeviceId;
            updateQrCodeWithValue(myAppUrl);
        }
    });
    sendMessageButton?.addEventListener('click', handleSendMessage);
    sendPostButton?.addEventListener('click', handleSendPost);
    sendDirectFileButton?.addEventListener('click', handleDirectSendFile);
    sendGroupFileButton?.addEventListener('click', handleGroupSendFile);
    callButton?.addEventListener('click', toggleVideoCall);
    frontCamButton?.addEventListener('click', () => handleVideoButtonClick('user'));
    backCamButton?.addEventListener('click', () => handleVideoButtonClick('environment'));
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
          if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
            connectWebSocket();
          } else if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
            // --- バッジクリア処理 ---
            if ('clearAppBadge' in navigator) {
                unreadCount = 0;
                navigator.clearAppBadge().catch(error => {
                    console.error('Failed to clear app badge:', error);
                });
            }
            startAutoConnectFriendsTimer();
          }
        } else {
          stopAutoConnectFriendsTimer();
        }
      });
    }

async function fetchSubscriptionStatus() {
    if (!myDeviceId) return; // myDeviceIdがない場合は何もしない
    try {
        const response = await fetch(`/api/stripe/subscription-status/?user_id=${myDeviceId}`);
        if (response.ok) {
            const data = await response.json();
            isSubscribed = data.is_subscribed;
        }
    } catch (error) {
        console.error('Failed to fetch subscription status:', error);
        isSubscribed = false; // エラー時は非課金として扱う
    }
}

async function handleSubscribeClick() {
    // サーバーから公開鍵を取得
    const keyResponse = await fetch('/api/stripe/public-key/');
    const keyData = await keyResponse.json();
    const stripePublicKey = keyData.publicKey;

    if (!stripePublicKey) {
        updateStatus('Could not retrieve payment configuration.', 'red');
        return;
    }

    const stripe = Stripe(stripePublicKey);

    // ユーザーのブラウザ言語設定から通貨を決定 (日本語ならjpy, それ以外はusd)
    const currency = getLang() === 'ja' ? 'jpy' : 'usd';

    try {
        const response = await fetch('/api/stripe/create-checkout-session/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken'),
                'Accept': 'application/json'
            },
            body: JSON.stringify({ user_id: myDeviceId, currency: currency })
        });
        const session = await response.json();
        if (session.id) {
            await stripe.redirectToCheckout({ sessionId: session.id });
        } else {
            // サーバーからのエラーメッセージを具体的に表示
            const errorMessage = session.error || 'An unknown error occurred while creating the checkout session.';
            updateStatus(`Could not create checkout session: ${errorMessage}`, 'red');
            console.error('Checkout session creation failed:', session);
        }
    } catch (error) {
        updateStatus(`Error during subscription process: ${error}`, 'red');
        console.error('Error in handleSubscribeClick:', error);
    }
}

let mailModal;
let currentMailTarget = null;

function createMailModal() {
    if (document.getElementById('mailModal')) return;

    const modal = document.createElement('div');
    modal.id = 'mailModal';
    modal.style.display = 'none';
    modal.style.position = 'fixed';
    modal.style.zIndex = '1000';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.overflow = 'auto';
    modal.style.backgroundColor = 'rgba(0,0,0,0.4)';

    const content = document.createElement('div');
    content.style.backgroundColor = '#fefefe';
    content.style.margin = '15% auto';
    content.style.padding = '20px';
    content.style.border = '1px solid #888';
    content.style.width = '80%';
    content.style.maxWidth = '500px';
    content.style.borderRadius = '8px';

    const title = document.createElement('h3');
    title.id = 'mailModalTitle';

    const textArea = document.createElement('textarea');
    textArea.id = 'mailContent';
    textArea.style.width = '100%';
    textArea.style.height = '100px';
    textArea.style.marginBottom = '10px';

    const dateLabel = document.createElement('label');
    dateLabel.id = 'mailDateLabel';
    dateLabel.style.display = 'block';
    dateLabel.style.marginBottom = '5px';

    const dateInput = document.createElement('input');
    dateInput.type = 'datetime-local';
    dateInput.id = 'mailNextAccess';
    dateInput.style.width = '100%';
    dateInput.style.marginBottom = '20px';

    const btnContainer = document.createElement('div');
    btnContainer.style.textAlign = 'right';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'mailCancelBtn';
    cancelBtn.style.marginRight = '10px';
    cancelBtn.onclick = closeMailModal;

    const sendBtn = document.createElement('button');
    sendBtn.id = 'mailSendBtn';
    sendBtn.onclick = sendMail;

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(sendBtn);

    content.appendChild(title);
    content.appendChild(textArea);
    content.appendChild(dateLabel);
    content.appendChild(dateInput);
    content.appendChild(btnContainer);

    modal.appendChild(content);
    document.body.appendChild(modal);
    mailModal = modal;
}

function openMailModal(friendId) {
    if (!mailModal) createMailModal();
    currentMailTarget = friendId;
    const lang = getLang();

    document.getElementById('mailModalTitle').textContent = `${i18n[lang].mail} to ${friendId.substring(0,6)}`;
    document.getElementById('mailContent').placeholder = i18n[lang].content;
    document.getElementById('mailDateLabel').textContent = i18n[lang].nextAccess;
    document.getElementById('mailCancelBtn').textContent = i18n[lang].cancel;
    document.getElementById('mailSendBtn').textContent = i18n[lang].sendMail;
    document.getElementById('mailContent').value = '';
    document.getElementById('mailNextAccess').value = '';

    mailModal.style.display = 'block';
}

function closeMailModal() {
    if (mailModal) mailModal.style.display = 'none';
    currentMailTarget = null;
}

async function sendMail() {
    if (!currentMailTarget) return;
    const content = document.getElementById('mailContent').value;
    const nextAccess = document.getElementById('mailNextAccess').value;

    if (!content) {
        alert("Please enter content.");
        return;
    }

    const mailData = {
        id: generateUUID(), // ローカルでの表示と重複チェックのためのクライアント側ID
        uuid: myDeviceId,
        sender: myDeviceId,
        target: currentMailTarget,
        content: content,
        nextAccess: nextAccess,
        timestamp: new Date().toISOString(),
    };

    // サーバーにメールを送信するためのペイロード
    const payloadForServer = {
        sender: myDeviceId,
        target: currentMailTarget,
        content: content,
        next_access: nextAccess, // Django側はsnake_caseを想定
        client_id: mailData.id
    };

    updateStatus("Sending mail...", "blue");

    try {
        const csrfToken = getCookie('csrftoken');
        const headers = {
            'Content-Type': 'application/json'
        };
        if (csrfToken) {
            headers['X-CSRFToken'] = csrfToken;
        }

        // このAPIはサーバー側で実装する必要があります
        const response = await fetch('/api/mails/send/', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payloadForServer)
        });

        if (!response.ok) {
            let errorMsg = 'Server returned an error.';
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch (e) {
                errorMsg = `Server Error: ${response.status} ${response.statusText}`;
            }
            throw new Error(errorMsg);
        }

        // サーバーからのレスポンスでmailDataを更新する（サーバー側IDなど）
        const responseData = await response.json();
        Object.assign(mailData, responseData.mail); // サーバーからのデータで上書き

        if (dbPromise) {
            const db = await dbPromise;
            await db.put('mails', mailData);
        }
        displayMailMessage(mailData);
        updateStatus(i18n[getLang()].mailSent, 'green');
        closeMailModal();
    } catch (error) {
        console.error("Failed to send mail via API:", error);
        updateStatus(`Failed to send mail: ${error.message}. Saved locally.`, 'red');
        // オフライン時やAPIエラー時は、とりあえずローカルに保存して表示する
        if (dbPromise) {
            const db = await dbPromise;
            await db.put('mails', mailData);
        }
        displayMailMessage(mailData);
        closeMailModal();
    }
}

async function main() {
  updateStatus('Initializing...', 'black');

  // DOM要素の取得をmain関数の最初に移動
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
  frontCamButton = document.getElementById('frontCamButton');
  backCamButton = document.getElementById('backCamButton');
  startScanButton = document.getElementById('startScanButton');
  if (!remoteVideosContainer) {
      remoteVideosContainer = document.querySelector('.video-scroll-container');
  }

  myDeviceId = localStorage.getItem('cybernetcall-deviceId') || generateUUID();
  localStorage.setItem('cybernetcall-deviceId', myDeviceId);
  setInteractionUiEnabled(false); // まずUIを無効化

  // 3. 課金状態の確認
  await fetchSubscriptionStatus(); // ページ読み込み時に課金状態を取得

  // 4. QRコードの表示
  if (myDeviceId && typeof myDeviceId === 'string' && myDeviceId.length > 0) {
    const myAppUrl = window.location.origin + '/?id=' + myDeviceId;
    updateQrCodeWithValue(myAppUrl);
  } else {
    console.error("Device ID is not available. Cannot generate QR code.");
    updateStatus("Error: Device ID missing. Cannot generate QR code.", "red");
  }
  
  // 5. データベースとUIの初期表示
  if (typeof idb === 'undefined' || !dbPromise) {
      updateStatus("Database features disabled. Offline functionality will be limited.", "orange");
  } else {
      await displayInitialPosts();
      await displayStoredMails();
      await displayFriendList();
  }

  // 5. WebSocket接続
  await connectWebSocket();

  // 6. URLパラメータ（友達追加リンク）の処理
  const urlParams = new URLSearchParams(window.location.search);
  const incomingFriendId = urlParams.get('id');
  if (incomingFriendId && incomingFriendId !== myDeviceId) {
      updateStatus(`Connecting from link with ${incomingFriendId.substring(0,6)}...`, 'blue');
      await addFriend(incomingFriendId);
      pendingConnectionFriendId = incomingFriendId;

      // WebSocket接続が確立された後にピア接続を開始する
      if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
          await createOfferForPeer(pendingConnectionFriendId);
          pendingConnectionFriendId = null;
      }
  }
}

// デバッグ用: コンソールから window.debugDumpMails() を実行してDBの中身を確認
window.debugDumpMails = async () => {
    if (!dbPromise) {
        console.log("Database not ready.");
        return;
    }
    const db = await dbPromise;
    const mails = await db.getAll('mails');
    console.table(mails);
    console.log("Total mails in DB:", mails.length);
};

document.addEventListener('DOMContentLoaded', () => {
    // 1. DOM要素の取得
    qrElement = document.getElementById('qrcode');
    statusElement = document.getElementById('connectionStatus');
    // ... (他の要素も同様に取得)
    // (前の修正からこのブロックをここに移動)
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
    directFileInputElement = document.getElementById('directFileInput');
    groupFileInputElement = document.getElementById('groupFileInput');
    onlineFriendSelector = document.getElementById('onlineFriendSelector');
    sendDirectFileButton = document.getElementById('sendDirectFile');
    sendGroupFileButton = document.getElementById('sendGroupFile');
    directFileTransferStatusElement = document.getElementById('direct-file-transfer-status');
    groupFileTransferStatusElement = document.getElementById('group-file-transfer-status');
    callButton = document.getElementById('callButton');
    frontCamButton = document.getElementById('frontCamButton');
    backCamButton = document.getElementById('backCamButton');
    startScanButton = document.getElementById('startScanButton');
    if (!remoteVideosContainer) {
        remoteVideosContainer = document.querySelector('.video-scroll-container');
    }
    if (statusElement) {
        statusElement.addEventListener('click', () => {
            statusElement.classList.toggle('status-expanded');
        });
    }

    // 2. UIイベントリスナーのセットアップ
    setupEventListeners();
    createMailModal();
    // Service Workerの登録

    onlineFriendSelector?.addEventListener('change', (event) => {
        selectedPeerId = event.target.value;
        updateStatus(selectedPeerId ? `Now chatting with ${selectedPeerId.substring(0,6)}` : 'No friend selected for chat.', 'blue');
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/static/cnc/service-worker.js')
            .then(registration => {
                console.log('Service Worker registered successfully.');
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
                updateStatus(`Offline features unavailable: ${error.message}`, 'orange');
            });
    } else {
        updateStatus('Offline features unavailable (Service Worker not supported)', 'orange');
    }

    // 3. メイン処理の開始
    main();
});
