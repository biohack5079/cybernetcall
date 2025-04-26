// app.js

let myDeviceId;
let selectedFriendId;
let peerConnection;
let dataChannel;
let socket;

let dbPromise = idb.openDB('cybernetcall-db', 1, {
  upgrade(db) {
    db.createObjectStore('posts', { keyPath: 'id' });
  }
});

// UUID生成
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// IndexedDBに投稿保存
async function savePost(post) {
  const db = await dbPromise;
  const tx = db.transaction('posts', 'readwrite');
  await tx.store.put(post);
  await tx.done;
}

// 投稿を表示
async function displayPosts() {
  const db = await dbPromise;
  const posts = await db.getAll('posts');
  const postArea = document.getElementById('postArea');
  postArea.innerHTML = '';
  posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post';
    div.textContent = post.content;
    postArea.appendChild(div);
  });
}

// 新しい投稿をローカルにも表示
function displayPost(post) {
  const postArea = document.getElementById('postArea');
  const div = document.createElement('div');
  div.className = 'post';
  div.textContent = post.content;
  postArea.appendChild(div);
}

// メッセージ受信処理
function handleDataChannelMessage(event) {
  const post = JSON.parse(event.data);
  console.log("Received post:", post);
  savePost(post);
  displayPost(post);
}

// WebSocketサーバーと接続
async function connectSignalingServer() {
  socket = new WebSocket('wss://your-signaling-server.com:8765'); // ← 本番は正しく設定
  socket.onopen = () => {
    console.log('Connected to signaling server');
    socket.send(JSON.stringify({ type: 'register', deviceId: myDeviceId }));
  };
  socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'offer') {
      await handleOffer(data.offer);
    } else if (data.type === 'answer') {
      await handleAnswer(data.answer);
    } else if (data.type === 'candidate') {
      await peerConnection.addIceCandidate(data.candidate);
    }
  };
}

// PeerConnection生成
async function createPeerConnection() {
  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
    }
  };
  peerConnection.ondatachannel = event => {
    dataChannel = event.channel;
    dataChannel.onmessage = handleDataChannelMessage;
  };
}

// Offer作成
async function createOffer() {
  dataChannel = peerConnection.createDataChannel('syncedwall');
  dataChannel.onmessage = handleDataChannelMessage;
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.send(JSON.stringify({ type: 'offer', offer: offer }));
}

// Offer受信
async function handleOffer(offer) {
  await peerConnection.setRemoteDescription(offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.send(JSON.stringify({ type: 'answer', answer: answer }));
}

// Answer受信
async function handleAnswer(answer) {
  await peerConnection.setRemoteDescription(answer);
}

// 投稿ボタン押したとき
document.getElementById('sendPost').addEventListener('click', async () => {
  const input = document.getElementById('postInput');
  const content = input.value.trim();
  if (content) {
    const post = {
      id: generateUUID(),
      content: content,
      timestamp: new Date().toISOString()
    };
    savePost(post);
    displayPost(post);
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(post));
    }
    input.value = '';
  }
});

// QRコードを読んで相手に接続
window.connectToFriend = async function(decodedText) {
  console.log("Connecting to friend...");
  myDeviceId = generateUUID();
  await connectSignalingServer();
  await createPeerConnection();
  await createOffer();
};

// 初期ロード時、ローカルの投稿を表示
displayPosts();

