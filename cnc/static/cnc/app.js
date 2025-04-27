// /home/my/d/cybernetcall/cnc/static/cnc/app.js
// 修正済みの完全なコード

// ==================================================
//  グローバル変数・状態管理
// ==================================================
let myDeviceId; // 自分のユニークID
let selectedFriendId; // 接続相手のID (QRスキャン後)
let peerConnection; // RTCPeerConnection インスタンス
let dataChannel; // RTCDataChannel インスタンス
let localStream; // 自分のカメラ・マイクのストリーム

// アプリケーションの状態
const AppState = {
  INITIAL: 'initial', // 初期状態、接続待機中
  CONNECTING: 'connecting', // 接続処理中 (Offer/Answer交換中)
  CONNECTED: 'connected', // 接続完了
  ERROR: 'error' // 何らかのエラーが発生
};
let currentAppState = AppState.INITIAL;

// UI要素への参照 (DOMContentLoaded内で取得)
let qrElement, statusElement, qrReaderElement, qrResultsElement, localVideoElement, remoteVideoElement, messageAreaElement, postAreaElement;

// IndexedDB Promise (idbライブラリが必要)
let dbPromise = typeof idb !== 'undefined' ? idb.openDB('cybernetcall-db', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('posts')) {
      db.createObjectStore('posts', { keyPath: 'id' });
    }
    // 他に必要なストアがあればここに追加
  }
}) : null; // idbがなければnull

if (!dbPromise) {
    console.error("idb library not loaded. IndexedDB features will be unavailable.");
}

// ==================================================
//  ユーティリティ関数
// ==================================================

// UUID生成
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// UI状態更新ヘルパー
function updateStatus(message, color = 'black') {
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = color;
        statusElement.style.display = message ? 'block' : 'none';
    }
    console.log(`Status Update: ${message} (State: ${currentAppState})`);
}

// ==================================================
//  IndexedDB 操作
// ==================================================

// IndexedDBに投稿保存
async function savePost(post) {
  if (!dbPromise) return; // idbがなければ何もしない
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

// ローカル投稿表示 (起動時)
async function displayInitialPosts() {
  if (!dbPromise || !postAreaElement) return;
  try {
    const db = await dbPromise;
    const posts = await db.getAll('posts');
    postAreaElement.innerHTML = ''; // クリア
    // 新しい順に表示する場合 (timestampがあればソート)
    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    posts.forEach(post => displayPost(post, false)); // isNew=false
    console.log(`Displayed ${posts.length} initial posts.`);
  } catch (error) {
    console.error("Error displaying initial posts:", error);
  }
}

// 単一投稿表示 (新規投稿/受信時)
function displayPost(post, isNew = true) {
  if (!postAreaElement) return;
  const div = document.createElement('div');
  div.className = 'post';
  // 投稿内容と投稿者ID（短縮）などを表示する例
  div.innerHTML = `<strong>${post.sender ? post.sender.substring(0, 6) : 'Unknown'}:</strong> ${post.content}`;
  // div.textContent = post.content; // シンプル版
  if (isNew && postAreaElement.firstChild) {
      postAreaElement.insertBefore(div, postAreaElement.firstChild);
  } else {
      postAreaElement.appendChild(div);
  }
}

// ==================================================
//  WebRTC コア機能
// ==================================================

// PeerConnection生成とイベントハンドラ設定
async function createPeerConnection() {
  if (peerConnection) {
    console.warn("Closing existing PeerConnection.");
    peerConnection.close();
  }
  console.log("Creating PeerConnection...");
  try {
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // GoogleのSTUNサーバー
    });

    // ICE Candidate 生成時
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        console.log('Generated ICE Candidate:', event.candidate);
        // 設計: QR経由でのICE交換は複雑なため、ここでは警告のみ
        console.warn("ICE candidate generated. Automatic exchange via QR not implemented.");
        // DHTや他のシグナリング手段を使う場合はここで送信
        // 例: sendSignalingMessage({ type: 'iceCandidate', candidate: event.candidate });
      } else {
        console.log("All ICE candidates have been gathered.");
      }
    };

    // データチャネル受信時 (相手がOfferを作成した場合)
    peerConnection.ondatachannel = event => {
      console.log("Data channel received:", event.channel.label);
      dataChannel = event.channel;
      setupDataChannelEvents(); // イベントハンドラ設定
    };

    // メディアトラック受信時
    peerConnection.ontrack = (event) => {
      console.log("Track received:", event.track.kind);
      if (remoteVideoElement && event.streams && event.streams[0]) {
        if (!remoteVideoElement.srcObject) {
          remoteVideoElement.srcObject = new MediaStream();
        }
        // 既存のストリームにトラックを追加
        remoteVideoElement.srcObject.addTrack(event.track);
        console.log(`Track ${event.track.id} added to remote video.`);
      } else {
          console.warn("Remote video element not found or stream missing in ontrack event.");
      }
    };

    // 接続状態変化時
    peerConnection.onconnectionstatechange = () => {
      console.log("PeerConnection state:", peerConnection.connectionState);
      switch (peerConnection.connectionState) {
        case 'connected':
          // DataChannelが開くまで待つ場合もあるが、ここでは接続完了とみなす
          if (currentAppState !== AppState.CONNECTED) {
              currentAppState = AppState.CONNECTED;
              updateStatus('接続完了！', 'green');
              if(qrElement) qrElement.style.display = 'none';
              if(qrReaderElement) qrReaderElement.style.display = 'none';
          }
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          // 接続が切れたら初期状態に戻る
          if (currentAppState === AppState.CONNECTED || currentAppState === AppState.CONNECTING) {
              currentAppState = AppState.INITIAL;
              updateStatus(`接続が切れました (${peerConnection.connectionState})`, 'red');
              resetConnection(); // 接続状態をリセット
          }
          break;
        case 'connecting':
          // 既にCONNECTING状態ならメッセージは更新しない
          if (currentAppState !== AppState.CONNECTING) {
              currentAppState = AppState.CONNECTING;
              updateStatus('接続中...', 'orange');
          }
          break;
        default:
            // 'new', 'checking' など
            if (currentAppState !== AppState.CONNECTING) {
                 updateStatus(`接続状態: ${peerConnection.connectionState}`, 'orange');
            }
      }
    };
    console.log("PeerConnection created.");
    return true;
  } catch (error) {
    console.error("Error creating PeerConnection:", error);
    updateStatus(`接続準備エラー: ${error.message}`, 'red');
    currentAppState = AppState.ERROR;
    return false;
  }
}

// DataChannelイベントハンドラ設定
function setupDataChannelEvents() {
    if (!dataChannel) return;
    dataChannel.onmessage = handleDataChannelMessage; // メッセージ受信
    dataChannel.onopen = () => {
        console.log("Data channel opened!");
        // DataChannelが開いたら確実に接続完了
        if (currentAppState !== AppState.CONNECTED) {
             currentAppState = AppState.CONNECTED;
             updateStatus('接続完了！ (DataChannel Ready)', 'green');
             if(qrElement) qrElement.style.display = 'none';
             if(qrReaderElement) qrReaderElement.style.display = 'none';
        }
    };
    dataChannel.onclose = () => {
        console.log("Data channel closed.");
        // DataChannelが閉じたら接続切れとみなす
        if (currentAppState === AppState.CONNECTED) {
            currentAppState = AppState.INITIAL;
            updateStatus('データ接続が切れました', 'red');
            resetConnection();
        }
    };
    dataChannel.onerror = (error) => {
        console.error("Data channel error:", error);
        currentAppState = AppState.ERROR;
        updateStatus(`データ通信エラー: ${error}`, 'red');
        resetConnection();
    };
}

// Offer作成 & LocalDescription設定
async function createOfferAndSetLocal() {
  if (!peerConnection) {
      console.error("Cannot create offer: PeerConnection not ready.");
      return null;
  }
  console.log("Creating DataChannel 'cybernetcall-data'...");
  try {
    // データチャネルを作成 (Offer作成側が主導)
    dataChannel = peerConnection.createDataChannel('cybernetcall-data');
    setupDataChannelEvents(); // 作成したDataChannelにイベントハンドラを設定
    console.log("Creating Offer...");
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log("Offer created and local description set.");
    return peerConnection.localDescription; // Offer SDP を返す
  } catch (error) {
    console.error("Error creating DataChannel, Offer or setting local description:", error);
    updateStatus(`Offer作成エラー: ${error.message}`, 'red');
    currentAppState = AppState.ERROR; // エラー状態に
    return null;
  }
}

// Offer受信 & Answer作成 & LocalDescription設定
async function handleOfferAndCreateAnswer(offerSdp) {
  if (!peerConnection) {
       console.error("Cannot handle offer: PeerConnection not ready.");
       return null;
  }
  console.log("Received offer, setting remote description...");
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
    console.log("Creating Answer...");
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log("Answer created and local description set.");
    return peerConnection.localDescription; // Answer SDP を返す
  } catch (error) {
    console.error("Error handling offer or creating/setting answer:", error);
    updateStatus(`Offer処理/Answer作成エラー: ${error.message}`, 'red');
    currentAppState = AppState.ERROR; // エラー状態に
    return null;
  }
}

// Answer受信 & RemoteDescription設定
async function handleAnswer(answerSdp) {
  if (!peerConnection) {
       console.error("Cannot handle answer: PeerConnection not ready.");
       return false;
  }
  console.log("Received answer, setting remote description...");
  try {
    // AnswerをRemoteDescriptionとして設定
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
    console.log("Remote description set with answer. Connection should establish soon.");
    return true;
  } catch (error) {
    console.error("Error setting remote description with answer:", error);
    updateStatus(`Answer処理エラー: ${error.message}`, 'red');
    currentAppState = AppState.ERROR; // エラー状態に
    return false;
  }
}

// 接続リセット
function resetConnection() {
    console.log("Resetting connection state...");
    // 進行中のスキャナーがあれば停止
    try {
        if (window.html5QrCodeScanner && window.html5QrCodeScanner.getState() === Html5QrcodeScannerState.SCANNING) {
            window.html5QrCodeScanner.stop();
        }
    } catch(e) { /* ignore */ }

    if (dataChannel) dataChannel.close();
    if (peerConnection) peerConnection.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        if(localVideoElement) localVideoElement.srcObject = null;
        const callButton = document.getElementById('callButton');
        const videoButton = document.getElementById('videoButton');
        if(callButton) callButton.textContent = '📞';
        if(videoButton) {
            videoButton.style.display = 'none';
            videoButton.textContent = '🎥';
        }
    }
    if (remoteVideoElement) remoteVideoElement.srcObject = null;

    peerConnection = null;
    dataChannel = null;
    selectedFriendId = null; // 相手IDもリセット
    currentAppState = AppState.INITIAL;

    // 初期QRとスキャナーを再表示
    updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
    if(qrElement) qrElement.style.display = 'block';
    if(qrReaderElement) qrReaderElement.style.display = 'block';
    updateStatus('接続待機中', 'black');
    startQrScanner(); // スキャナーを再起動
}

// ==================================================
//  DataChannel 通信処理
// ==================================================

// メッセージ受信処理 (type分岐)
function handleDataChannelMessage(event) {
  try {
    const message = JSON.parse(event.data);
    console.log("Received message:", message);
    switch (message.type) {
        case 'post':
            savePost(message); // 保存
            displayPost(message, true); // 表示
            break;
        case 'direct-message':
            displayDirectMessage(message, false); // 表示 (相手から)
            break;
        // 他のタイプがあれば追加 (例: 'file-info')
        default:
            console.warn("Received unknown message type:", message.type);
            // 旧バージョン互換 (typeなしなら投稿とみなす)
            if (!message.type && message.content && message.id) {
                 console.log("Assuming received data is a post (legacy format).");
                 savePost(message);
                 displayPost(message, true);
            }
    }
  } catch (error) {
      console.error("Error parsing received data:", error, event.data);
  }
}

// Direct Mail 送信
function handleSendMessage() {
    const input = document.getElementById('messageInput');
    const content = input?.value.trim();
    if (content && dataChannel && dataChannel.readyState === 'open') {
        const message = {
            type: 'direct-message',
            content: content,
            sender: myDeviceId,
            timestamp: new Date().toISOString()
        };
        dataChannel.send(JSON.stringify(message));
        displayDirectMessage(message, true); // 自分にも表示
        if(input) input.value = '';
    } else if (!dataChannel || dataChannel.readyState !== 'open') {
        alert("接続されていません。");
    }
}

// Direct Mail 表示
function displayDirectMessage(message, isOwnMessage = false) {
    if (!messageAreaElement) return;
    const div = document.createElement('div');
    div.classList.add('message', isOwnMessage ? 'own-message' : 'peer-message');
    // 送信者IDを表示する例
    div.innerHTML = `<strong>${isOwnMessage ? 'You' : (message.sender ? message.sender.substring(0, 6) : 'Peer')}:</strong> ${message.content}`;
    // div.textContent = message.content; // 内容のみ
    messageAreaElement.appendChild(div);
    messageAreaElement.scrollTop = messageAreaElement.scrollHeight; // 自動スクロール
}

// 投稿送信 (typeを追加)
async function handleSendPost() {
  const input = document.getElementById('postInput');
  const content = input?.value.trim();
  if (content) {
    const post = {
      type: 'post', // typeを追加
      id: generateUUID(),
      content: content,
      sender: myDeviceId,
      timestamp: new Date().toISOString()
    };
    await savePost(post); // ローカル保存
    displayPost(post, true); // ローカル表示
    // 接続中の相手がいれば送信
    if (dataChannel && dataChannel.readyState === 'open') {
      dataChannel.send(JSON.stringify(post));
      console.log("Post sent via DataChannel:", post.id);
    } else {
        console.log("Post saved locally, but not sent (no open DataChannel).");
    }
    if(input) input.value = ''; // 入力欄クリア
  }
}

// ファイル送信 (スタブ)
function handleSendFile() {
    alert("ファイル送信機能は未実装です。");
    // TODO: 実装 (FileReader, Chunkingなど)
}

// ==================================================
//  メディア処理 (ビデオ通話)
// ==================================================

// ビデオ通話の開始/停止
async function toggleVideoCall() {
    const callButton = document.getElementById('callButton');
    const videoButton = document.getElementById('videoButton');
    if (!peerConnection || currentAppState !== AppState.CONNECTED) {
        alert("まず相手と接続してください。");
        return;
    }
    if (!localStream) { // 開始
        console.log("Starting video call...");
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideoElement) localVideoElement.srcObject = localStream;
            // トラックをPeerConnectionに追加
            localStream.getTracks().forEach(track => {
                try {
                    peerConnection.addTrack(track, localStream);
                } catch (e) { console.error("Error adding track:", e); }
            });
            if(callButton) callButton.textContent = 'End Call';
            if(videoButton) videoButton.style.display = 'inline-block'; // ON/OFFボタン表示
        } catch (error) {
            console.error("Error starting video call:", error);
            alert(`メディアアクセスエラー: ${error.message}`);
            localStream = null; // 失敗したらストリームをnullに戻す
        }
    } else { // 終了
        console.log("Ending video call...");
        localStream.getTracks().forEach(track => track.stop()); // トラック停止
        localStream = null;
        // PeerConnectionからトラックを削除
        peerConnection.getSenders().forEach(sender => {
            if (sender.track) {
                try {
                    peerConnection.removeTrack(sender);
                } catch (e) { console.error("Error removing track:", e); }
            }
        });
        if(localVideoElement) localVideoElement.srcObject = null; // ローカル表示クリア
        // リモート表示クリアは相手のトラック停止に依存するため、ここでは行わない
        if(callButton) callButton.textContent = '📞'; // ボタン表示戻す
        if(videoButton) {
            videoButton.style.display = 'none'; // ON/OFFボタン非表示
            videoButton.textContent = '🎥'; // アイコン戻す
        }
    }
}

// ビデオのオン/オフ
function toggleLocalVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        const videoButton = document.getElementById('videoButton');
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled; // 有効/無効を切り替え
            if(videoButton) videoButton.textContent = videoTrack.enabled ? '🎥' : '🚫'; // ボタン表示更新
            console.log(`Local video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
        }
    }
}

// ==================================================
//  QRコード処理 (表示・スキャン)
// ==================================================

// 指定された値でQRコードを更新
function updateQrCodeWithValue(value) {
    if (!qrElement) {
        console.warn("QR element not available for update.");
        return;
    }
    const size = Math.min(window.innerWidth * 0.8, 300); // サイズ調整
    // QRiousライブラリのロード確認
    if (typeof QRious !== 'undefined') {
        try {
            new QRious({ element: qrElement, value: value || '', size: size, level: 'H' }); // 高いエラー訂正レベル
            console.log("QR Code updated:", value);
        } catch (e) { console.error("QRious error:", e); }
    } else {
        console.error("QRious not loaded.");
        // リトライ (初回ロード時など)
        setTimeout(() => updateQrCodeWithValue(value), 500);
    }
}

// QRコードスキャナー起動
function startQrScanner() {
    // 接続中やエラー状態ではスキャナーを起動しない
    if (currentAppState !== AppState.INITIAL) {
        console.log(`QR Scanner not starting in state: ${currentAppState}`);
        if(qrReaderElement) qrReaderElement.style.display = 'none';
        return;
    }
    if (!qrReaderElement) {
        console.warn("QR Reader element not available for start.");
        return;
    }

    // Html5Qrcodeライブラリのロード確認
    if (typeof Html5Qrcode !== 'undefined') {
        // 既存のスキャナーインスタンスがあれば停止試行 (エラー無視)
        try {
            // グローバルに保持する場合
            if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.getState === 'function' && window.html5QrCodeScanner.getState() === 2) { // 2: SCANNING state
                 window.html5QrCodeScanner.stop();
            }
            // ローカル変数で保持する場合 (より推奨)
            // if (localScannerInstance && localScannerInstance.getState() === ...) { ... }
        } catch (e) { console.warn("Error stopping previous scanner:", e); }

        // 新しいインスタンスを作成 (グローバルに保持する例)
        window.html5QrCodeScanner = new Html5Qrcode("qr-reader");
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            console.log(`QR Scan success: ${decodedText}`);
            if (qrResultsElement) qrResultsElement.textContent = `スキャン成功`;
            setTimeout(() => { if(qrResultsElement) qrResultsElement.textContent = ''; }, 1500); // 短時間表示

            // スキャナー停止
            window.html5QrCodeScanner.stop().then(ignore => {
                console.log("QR Scanner stopped.");
                if(qrReaderElement) qrReaderElement.style.display = 'none'; // スキャン成功したら非表示
            }).catch(err => console.error("QR Scanner stop failed:", err));

            // スキャンしたデータを処理
            handleScannedQrData(decodedText);
        };
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        console.log("Starting QR scanner...");
        qrReaderElement.style.display = 'block'; // 表示
        // スキャン開始
        window.html5QrCodeScanner.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
            .catch(err => {
                console.error(`QR Scanner start error: ${err}`);
                updateStatus(`QRスキャナーエラー: ${err.message}`, 'red');
                if(qrReaderElement) qrReaderElement.style.display = 'none'; // エラー時も非表示
            });
    } else {
        console.error("Html5Qrcode not loaded.");
        // リトライ (初回ロード時など)
        setTimeout(startQrScanner, 500);
    }
}

// スキャンしたQRデータの処理 (合わせ鏡シグナリングの中核)
async function handleScannedQrData(decodedText) {
    console.log("Handling scanned data:", decodedText);
    try {
        const data = JSON.parse(decodedText);
        console.log("Parsed data:", data);

        // 既に接続済みなら無視
        if (currentAppState === AppState.CONNECTED) {
            console.log("Already connected. Ignoring scanned data.");
            updateStatus("既に接続済みです。", "green");
            return;
        }
        // 接続処理中に別のQRをスキャンした場合 (Answer以外はリセット)
        if (currentAppState === AppState.CONNECTING && data.type !== 'answer') {
            console.warn("Received new QR during connection attempt. Resetting...");
            resetConnection();
            // リセット後に再度処理を試みる (初期QRの場合)
            if (data.type === 'initial') {
                await handleScannedQrData(decodedText); // 自分自身を再帰呼び出し
            }
            return;
        }

        // 相手の初期情報を受け取った場合 (自分が初期状態)
        if (data.type === 'initial' && currentAppState === AppState.INITIAL) {
            selectedFriendId = data.deviceId;
            updateStatus(`相手 (${selectedFriendId.substring(0,6)}...) 認識。Offer作成中...`, 'orange');
            currentAppState = AppState.CONNECTING; // 接続処理開始
            if (await createPeerConnection()) { // PeerConnection作成
                const offerSdp = await createOfferAndSetLocal(); // Offer作成 & Local設定
                if (offerSdp) {
                    const offerData = { type: 'offer', sdp: offerSdp, senderId: myDeviceId };
                    updateQrCodeWithValue(JSON.stringify(offerData)); // OfferをQR表示
                    updateStatus('Offer作成完了。相手にスキャンさせてください。', 'blue');
                    // 相手のAnswer待ち状態へ (状態は CONNECTING のまま)
                } else { currentAppState = AppState.ERROR; resetConnection(); } // Offer作成失敗
            } else { currentAppState = AppState.ERROR; resetConnection(); } // PeerConnection作成失敗
        }
        // 相手のOfferを受け取った場合 (自分が初期状態)
        else if (data.type === 'offer' && currentAppState === AppState.INITIAL) {
            selectedFriendId = data.senderId;
            updateStatus(`相手 (${selectedFriendId.substring(0,6)}...) からOffer受信。Answer作成中...`, 'orange');
            currentAppState = AppState.CONNECTING; // 接続処理開始
            if (await createPeerConnection()) { // PeerConnection作成
                const answerSdp = await handleOfferAndCreateAnswer(data.sdp); // Offer処理 & Answer作成 & Local設定
                if (answerSdp) {
                    const answerData = { type: 'answer', sdp: answerSdp, senderId: myDeviceId };
                    updateQrCodeWithValue(JSON.stringify(answerData)); // AnswerをQR表示
                    updateStatus('Answer作成完了。相手にスキャンさせてください。', 'blue');
                    // 接続確立待ち状態へ (状態は CONNECTING のまま)
                } else { currentAppState = AppState.ERROR; resetConnection(); } // Answer作成失敗
            } else { currentAppState = AppState.ERROR; resetConnection(); } // PeerConnection作成失敗
        }
        // 相手のAnswerを受け取った場合 (自分がOffer送信後 = CONNECTING状態)
        else if (data.type === 'answer' && currentAppState === AppState.CONNECTING && peerConnection?.localDescription?.type === 'offer') {
             updateStatus('相手からAnswer受信。接続中...', 'orange');
             if (await handleAnswer(data.sdp)) { // Answer処理 & Remote設定
                 console.log("Answer processed. Waiting for connection state change.");
                 // 接続完了は onconnectionstatechange または ondatachannel.onopen で検知される
             } else { currentAppState = AppState.ERROR; resetConnection(); } // Answer処理失敗
        }
        // 予期しないデータや状態の場合
        else {
            console.warn(`Unexpected data type ${data.type} in state ${currentAppState}`);
            updateStatus(`予期しないデータ(${data.type})または状態(${currentAppState})です。`, 'orange');
            // 必要ならリセット処理
            // resetConnection();
        }
    } catch (error) {
        console.error("Error handling scanned data:", error);
        updateStatus(`QRデータ処理エラー: ${error.message}`, 'red');
        currentAppState = AppState.ERROR; // エラー状態に
        resetConnection(); // エラー時はリセット推奨
    }
}

// ==================================================
//  イベントリスナー設定
// ==================================================
function setupEventListeners() {
    // リサイズイベント (QRコード再描画)
    window.addEventListener('resize', () => {
        // QRコードが表示されている場合のみ再描画
        if (qrElement && qrElement.style.display !== 'none') {
             if (currentAppState === AppState.INITIAL) {
                 updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
             } else if (currentAppState === AppState.CONNECTING && peerConnection?.localDescription) {
                 // Offer/Answer表示中の場合
                 const sdpData = { type: peerConnection.localDescription.type, sdp: peerConnection.localDescription, senderId: myDeviceId };
                 updateQrCodeWithValue(JSON.stringify(sdpData));
             }
        }
    });

    // ボタンイベント
    document.getElementById('sendMessage')?.addEventListener('click', handleSendMessage);
    document.getElementById('sendPost')?.addEventListener('click', handleSendPost);
    document.getElementById('sendFile')?.addEventListener('click', handleSendFile);
    document.getElementById('callButton')?.addEventListener('click', toggleVideoCall);
    document.getElementById('videoButton')?.addEventListener('click', toggleLocalVideo);

    console.log("Event listeners set up.");
}

// ==================================================
//  初期化処理 (DOM読み込み後に実行)
// ==================================================
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM fully loaded and parsed. Initializing app...");

  // 0. UI要素取得
  qrElement = document.getElementById('qrcode');
  statusElement = document.getElementById('connectionStatus'); // index.htmlに追加が必要
  qrReaderElement = document.getElementById('qr-reader');
  qrResultsElement = document.getElementById('qr-reader-results');
  localVideoElement = document.getElementById('localVideo');
  remoteVideoElement = document.getElementById('remoteVideo');
  messageAreaElement = document.getElementById('messageArea');
  postAreaElement = document.getElementById('postArea');

  // idbライブラリのロード確認
  if (typeof idb === 'undefined') {
      updateStatus("データベース機能が無効です (idbライブラリ未読込)", "orange");
  }

  // 1. 自分のID生成
  myDeviceId = generateUUID();
  console.log("My Device ID:", myDeviceId);

  // 2. IndexedDBから投稿表示
  displayInitialPosts();

  // 3. イベントリスナー設定
  setupEventListeners();

  // 4. 初期QRコード表示
  updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
  updateStatus('接続待機中', 'black');

  // 5. QRスキャナー起動
  startQrScanner();

  // 6. Service Worker 登録 (修正済み)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/cnc/service-worker.js') // 正しいパス
      .then(registration => {
        console.log('Service Worker registered successfully with scope:', registration.scope);
        // Service Worker 更新チェック (任意)
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.log('New content is available; please refresh.');
                  // 必要ならユーザーに更新通知を表示
                  // 例: updateStatus("新しいバージョンがあります。リロードしてください。", "blue");
                } else {
                  console.log('Content is cached for offline use.');
                }
              }
            };
          }
        };
      })
      .catch(error => {
        console.error('Service Worker registration failed:', error);
        updateStatus(`Service Worker登録エラー: ${error.message}`, 'red');
      });
  } else {
    console.log("Service Worker not supported.");
    updateStatus('オフライン機能は利用できません (Service Worker非対応)', 'orange');
  }

  console.log("App initialization complete.");
  currentAppState = AppState.INITIAL; // 初期状態を明確化

}); // End of DOMContentLoaded listener
