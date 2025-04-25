// app.js
let myDeviceId;
let selectedFriendId;
let peerConnection;
let dataChannel;
let socket;
let localStream;
let remoteStream;
let nickname;

// Function to generate a UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Initialize IndexedDB
const dbPromise = idb.openDB('my-app-db', 1, { // データベース名を変更
    upgrade(db) {
        if (!db.objectStoreNames.contains('friends')) {
            db.createObjectStore('friends', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('messages')) {
            db.createObjectStore('messages', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('device')) {
            db.createObjectStore('device', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('posts')) {
            db.createObjectStore('posts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('nicknames')) {
            db.createObjectStore('nicknames', { keyPath: 'id' });
        }
    },
});

// Get or create device ID
async function getOrCreateDeviceId() {
    const db = await dbPromise;
    const tx = db.transaction('device', 'readwrite');
    const store = tx.objectStore('device');
    let device = await store.get('myDeviceId');
    if (!device) {
        myDeviceId = generateUUID();
        await store.add({ id: 'myDeviceId', deviceId: myDeviceId });
        device = { deviceId: myDeviceId };
    } else {
        myDeviceId = device.deviceId;
    }
    return device.deviceId;
}

// Save message to IndexedDB
async function saveMessage(message) {
    const db = await dbPromise;
    const tx = db.transaction('messages', 'readwrite');
    const store = tx.objectStore('messages');
    message.id = generateUUID();
    await store.add(message);
    await tx.done;
}

// Save post to IndexedDB
async function savePost(post) {
    const db = await dbPromise;
    const tx = db.transaction('posts', 'readwrite');
    const store = tx.objectStore('posts');
    post.id = generateUUID();
    await store.add(post);
    await tx.done;
}

// Save file to IndexedDB
async function saveFile(file) {
    const db = await dbPromise;
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    file.id = generateUUID();
    await store.add(file);
    await tx.done;
}

// Display message area
function displayMessageArea() {
    const messageArea = document.getElementById('messageArea');
    messageArea.innerHTML = '';
}

// Display messages
async function displayMessages(friendId) {
    const db = await dbPromise;
    const messages = await db.getAll('messages');
    const messageArea = document.getElementById('messageArea');
    messageArea.innerHTML = '';
    for (const message of messages) {
        if ((message.senderId === myDeviceId && message.receiverId === friendId) || (message.senderId === friendId && message.receiverId === myDeviceId)) {
            displayMessage(message);
        }
    }
}

// Display a single message
function displayMessage(message) {
    const messageArea = document.getElementById('messageArea');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.senderId === myDeviceId ? 'sent' : 'received'}`;
    messageDiv.textContent = message.content;
    messageArea.appendChild(messageDiv);
}

// Display post area
function displayPostArea() {
    const postArea = document.getElementById('postArea');
    postArea.innerHTML = '';
}

// Display posts
async function displayPosts() {
    const db = await dbPromise;
    const posts = await db.getAll('posts');
    const postArea = document.getElementById('postArea');
    postArea.innerHTML = '';
    for (const post of posts) {
        displayPost(post);
    }
}

// Display a single post
function displayPost(post) {
    const postArea = document.getElementById('postArea');
    const postDiv = document.createElement('div');
    postDiv.className = `post`;
    postDiv.textContent = post.content;
    postArea.appendChild(postDiv);
}

// Send message
async function sendMessage(content, receiverId) {
    const message = {
        type: 'message',
        senderId: myDeviceId,
        receiverId: receiverId,
        content: content,
        timestamp: new Date().toISOString(),
    };

    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify(message));
    } else {
        console.log('DataChannel not open. Saving message for later.');
    }
    await saveMessage(message);
    displayMessage(message);
}

// Send post
async function sendPost(content) {
    const post = {
        type: 'post',
        senderId: myDeviceId,
        content: content,
        timestamp: new Date().toISOString(),
    };

    await savePost(post);
    displayPost(post);
}

// Send file
async function sendFile(file) {
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(file);
    } else {
        console.log('DataChannel not open. Saving file for later.');
    }
    await saveFile(file);
}

// Connect to signaling server
async function connectSignalingServer(ngrokUrl) {
    // ngrokUrlをwindowオブジェクトに登録
    window.ngrokUrl = ngrokUrl;
    // ngrokUrlが変更されたことを通知
    window.dispatchEvent(new Event('ngrokUrlChanged'));

    socket = new WebSocket('wss://.ngrok-free.app:8765');

    socket.onopen = () => {
        console.log('Signaling server connected');
        socket.send(JSON.stringify({ type: 'register', deviceId: myDeviceId, ngrokUrl: ngrokUrl }));
    };

    socket.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('Received signaling message:', data);

        if (data.type === 'bootstrap_info') {
            //ブートストラップノードの情報を取得
            console.log("bootstrap_info:", data.multiaddrs);
        } else if (data.type === 'offer') {
            // 他のユーザーから接続要求を受け取った場合
            await handleOffer(data.offer);
        } else if (data.type === 'answer') {
            // 接続要求に対する応答を受け取った場合
            await handleAnswer(data.answer);
        } else if (data.type === 'candidate') {
            // ICE candidate を受け取った場合
            await handleCandidate(data.candidate);
        } else if (data.type === 'friendList') {
            //友達リストの更新
            await updateFriendList(data.friends);
        }
    };

    socket.onclose = () => {
        console.log('Signaling server closed');
        setTimeout(connectSignalingServer, 3000); // Reconnect after 3 seconds
    };

    socket.onerror = (error) => {
        console.error('Signaling server error:', error);
    };
}

// Create peer connection
async function createPeerConnection() {
    peerConnection = new RTCPeerConnection({
        iceServers: [
            {
                urls: 'stun:stun.l.google.com:19302'
            }
        ]
    });

    peerConnection.onicecandidate = handleICECandidateEvent;
    peerConnection.oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
    peerConnection.ondatachannel = handleDataChannelEvent;
    peerConnection.ontrack = handleTrackEvent;
}

// Handle ICE candidate event
function handleICECandidateEvent(event) {
    if (event.candidate) {
        console.log('ICE candidate:', event.candidate);
        socket.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
    }
}

// Handle ICE connection state change event
function handleICEConnectionStateChangeEvent(event) {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
}

// Handle data channel event
function handleDataChannelEvent(event) {
    console.log('Data channel created');
    dataChannel = event.channel;
    dataChannel.onopen = handleDataChannelOpen;
    dataChannel.onmessage = handleDataChannelMessage;
}

// Handle data channel open
function handleDataChannelOpen(event) {
    console.log('Data channel open');
}

// Handle data channel message
function handleDataChannelMessage(event) {
    console.log('Data channel message:', event.data);
    if (typeof event.data === 'string') {
        const message = JSON.parse(event.data);
        saveMessage(message);
        if (message.senderId === selectedFriendId || message.receiverId === selectedFriendId) {
            displayMessage(message);
        }
    } else {
        const file = event.data;
        saveFile(file);
    }
}

// Handle track event
function handleTrackEvent(event) {
    console.log('Track event:', event);
    remoteStream = event.streams[0];
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = remoteStream;
}

// Create offer
async function createOffer() {
    dataChannel = peerConnection.createDataChannel('chat');
    dataChannel.onopen = handleDataChannelOpen;
    dataChannel.onmessage = handleDataChannelMessage;

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log('Offer created:', offer);
    socket.send(JSON.stringify({ type: 'offer', offer: offer }));
}

// Handle offer
async function handleOffer(offer) {
    await peerConnection.setRemoteDescription(offer);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log('Answer created:', answer);
    socket.send(JSON.stringify({ type: 'answer', answer: answer }));
}

// Handle answer
async function handleAnswer(answer) {
    await peerConnection.setRemoteDescription(answer);
    console.log('Answer set');
}

// Handle candidate
async function handleCandidate(candidate) {
    await peerConnection.addIceCandidate(candidate);
    console.log('Candidate added');
}

// Update friend list
async function updateFriendList(friends) {
    const db = await dbPromise;
    const tx = db.transaction('friends', 'readwrite');
    const store = tx.objectStore('friends');
    await store.clear();
    for (const friend of friends) {
        await store.add(friend);
    }
    await tx.done;
    displayFriendList();
}

// Display friend list
async function displayFriendList() {
    const db = await dbPromise;
    const friends = await db.getAll('friends');
    const list = document.getElementById('friendList');
    list.innerHTML = '';
    for (const friend of friends) {
        const div = document.createElement('div');
        div.className = 'friend';
        div.innerHTML = `
            <img src="https://example.com/icon.jpg">
            <div class="friend-info">
                <div class="friend-name">${friend.name}</div>
                <div class="friend-status">Last Login: ${friend.lastLogin}</div>
            </div>`;
        div.addEventListener('click', () => {
            selectedFriendId = friend.id;
            displayMessageArea();
            displayMessages(friend.id);
        });
        list.appendChild(div);
    }
}

// Event listeners
document.getElementById('sendMessage').addEventListener('click', () => {
    const messageInput = document.getElementById('messageInput');
    const messageContent = messageInput.value;
    if (messageContent && selectedFriendId) {
        sendMessage(messageContent, selectedFriendId);
        messageInput.value = '';
    }
});

document.getElementById('sendPost').addEventListener('click', () => {
    const postInput = document.getElementById('postInput');
    const postContent = postInput.value;
    if (postContent) {
        sendPost(postContent);
        postInput.value = '';
    }
});

document.getElementById('fileInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    sendFile(file);
});

// カメラのオンオフを切り替える関数
window.toggleVideo = function(isVideoOn) {
    console.log("カメラ:", isVideoOn ? "オン" : "オフ");
    // ここでカメラのオンオフを切り替える処理を記述する
    // 例：ローカルストリームのビデオトラックを有効/無効にする
    if (localStream) {
        localStream.getVideoTracks().forEach(track => {
            track.enabled = isVideoOn;
        });
    }
    // カメラがオンになったら、getUserMedia()を呼び出す
    if (isVideoOn) {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then(stream => {
                localStream = stream;
                localVideo.srcObject = localStream;
                localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
            })
            .catch(error => {
                console.error('Error accessing media devices.', error);
            });
    }
};

// 通話を開始する関数
window.startCall = async function() {
    console.log("通話を開始します");
    // ここで通話を開始する処理を記述する
    // 例：WebRTCの接続を開始する
    if (peerConnection && peerConnection.connectionState === 'connected') {
        // 通話終了処理
        peerConnection.close();
        peerConnection = null;
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        if (remoteStream) {
            remoteStream = null;
        }
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = null;
        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = null;
    } else {
        // 通話開始処理
        await createOffer();
    }
};

// 音声のオンオフを切り替える関数
window.toggleAudio = function(isAudioOn) {
    console.log("音声:", isAudioOn ? "オン" : "オフ");
    // ここで音声のオンオフを切り替える処理を記述する
    // 例：ローカルストリームのオーディオトラックを有効/無効にする
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = isAudioOn;
        });
    }
};

// DHT関連の処理
window.connectToFriend = async function(friendInfo) {
    console.log('Connecting to friend:', friendInfo);
    // ここでDHTを使って友達を検索し、接続を試みる処理を実装する
    // 例：friendInfoを元に、libp2pで友達を検索し、接続を試みる
    // 接続が成功したら、WebRTCでピアツーピア接続を確立する
    // 友達リストを更新する
    await createPeerConnection();
    await createOffer();
};

// Initialize
(async () => {
    await getOrCreateDeviceId();
    displayPostArea();
    displayPosts();
    await connectSignalingServer(window.ngrokUrl);
    //await createPeerConnection();
    //await createOffer();
})();
