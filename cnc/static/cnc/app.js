// /home/my/d/cybernetcall/cnc/static/cnc/app.js
// Final P2P implementation with Offer/Answer, ICE Exchange via QR, and File Transfer.

// ==================================================
//  Global Variables & State Management
// ==================================================
let myDeviceId;
let peerConnection;
let dataChannel;
let localStream;
let iceCandidatesQueue = [];
let receivedIceCandidatesQueue = [];
let peerId = null;

// Application states
const AppState = { /* ... (No changes from previous) ... */
  INITIAL: 'initial',
  CREATING_OFFER: 'creating_offer',
  WAITING_FOR_ANSWER: 'waiting_for_answer',
  PROCESSING_OFFER: 'processing_offer',
  WAITING_FOR_CONNECTION: 'waiting_for_connection',
  EXCHANGING_CANDIDATES: 'exchanging_candidates',
  CONNECTED: 'connected',
  ERROR: 'error'
};
let currentAppState = AppState.INITIAL;

// UI element references
let qrElement, statusElement, qrReaderElement, qrResultsElement,
    localVideoElement, remoteVideoElement, messageAreaElement, postAreaElement,
    callButton, videoButton, fileInputElement, sendFileButton, fileTransferAreaElement;

// File Transfer State
let fileToSend = null;
let sendingFileMeta = null; // { name, size, type, id }
let receivingFileMeta = {}; // Store meta by fileId: { name, size, type, receivedSize, chunks }
const CHUNK_SIZE = 16 * 1024; // 16KB chunk size
const MAX_BUFFERED_AMOUNT = 10 * 1024 * 1024; // 10MB buffer threshold

// IndexedDB Promise
let dbPromise = typeof idb !== 'undefined' ? idb.openDB('cybernetcall-db', 1, { /* ... */ }) : null;
if (!dbPromise) console.error("idb library not loaded.");

// ==================================================
//  Utility Functions
// ==================================================
function generateUUID() { /* ... (No changes) ... */ }
function updateStatus(message, color = 'black') { /* ... (No changes) ... */ }
function showQrCode(show = true) { /* ... (No changes) ... */ }
function showQrScanner(show = true) { /* ... (No changes) ... */ }
function stopQrScanner() { /* ... (No changes) ... */ }
// (Copy implementations from the previous provided code if needed)
// Generate UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Update UI status helper
function updateStatus(message, color = 'black') {
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = color;
        statusElement.style.display = message ? 'block' : 'none';
    }
    console.log(`Status Update: ${message} (State: ${currentAppState})`);
}

// Show/Hide QR Code and Scanner
function showQrCode(show = true) {
    if (qrElement) qrElement.style.display = show ? 'block' : 'none';
}
function showQrScanner(show = true) {
    if (qrReaderElement) qrReaderElement.style.display = show ? 'block' : 'none';
    if (show) {
        startQrScanner(); // Start scanner only when showing
    } else {
        stopQrScanner(); // Stop scanner when hiding
    }
}

// Stop QR Scanner safely
function stopQrScanner() {
    try {
        // Assuming Html5QrcodeScannerState.SCANNING is 2
        if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.getState === 'function' && window.html5QrCodeScanner.getState() === 2) {
             window.html5QrCodeScanner.stop().catch(e => console.warn("Scanner stop error:", e));
             console.log("QR Scanner stopped.");
        }
    } catch(e) { console.warn("Error stopping scanner:", e); }
}


// ==================================================
//  IndexedDB Operations
// ==================================================
async function savePost(post) { /* ... (No changes) ... */ }
async function displayInitialPosts() { /* ... (No changes) ... */ }
function displayPost(post, isNew = true) { /* ... (No changes) ... */ }
// (Copy implementations from the previous provided code if needed)
// Save post to IndexedDB
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

// Display initial posts from IndexedDB on startup
async function displayInitialPosts() {
  if (!dbPromise || !postAreaElement) return;
  try {
    const db = await dbPromise;
    const posts = await db.getAll('posts');
    postAreaElement.innerHTML = ''; // Clear area
    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    posts.forEach(post => displayPost(post, false));
    console.log(`Displayed ${posts.length} initial posts.`);
  } catch (error) {
    console.error("Error displaying initial posts:", error);
  }
}

// Display a single post
function displayPost(post, isNew = true) {
  if (!postAreaElement) return;
  const div = document.createElement('div');
  div.className = 'post';
  div.innerHTML = `<strong>${post.sender ? post.sender.substring(0, 6) : 'Unknown'}:</strong> ${post.content}`;
  if (isNew && postAreaElement.firstChild) {
      postAreaElement.insertBefore(div, postAreaElement.firstChild);
  } else {
      postAreaElement.appendChild(div);
  }
}


// ==================================================
//  WebRTC Core Functions
// ==================================================
async function createPeerConnection() { /* ... (No changes) ... */ }
function setupDataChannelEvents() { /* ... (Minor changes for file transfer) ... */ }
async function createOfferAndSetLocal() { /* ... (No changes) ... */ }
async function handleOfferAndCreateAnswer(offerSdp) { /* ... (No changes) ... */ }
async function handleAnswer(answerSdp) { /* ... (No changes) ... */ }
async function handleIceCandidate(candidate) { /* ... (No changes) ... */ }
function processReceivedIceCandidates() { /* ... (No changes) ... */ }
function displayIceCandidatesQr() { /* ... (No changes) ... */ }
function resetConnection() { /* ... (Minor changes for file transfer state) ... */ }
// (Copy implementations from the previous provided code, applying minor changes below)

// Create PeerConnection and set up event handlers
async function createPeerConnection() {
  if (peerConnection) {
    console.warn("Closing existing PeerConnection.");
    peerConnection.close();
  }
  console.log("Creating PeerConnection...");
  iceCandidatesQueue = [];
  receivedIceCandidatesQueue = [];
  sendingFileMeta = null; // Reset file sending state
  receivingFileMeta = {}; // Reset file receiving state

  try {
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // ICE Candidate handling
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        console.log('Generated ICE Candidate:', event.candidate);
        iceCandidatesQueue.push(event.candidate);
        if (currentAppState === AppState.EXCHANGING_CANDIDATES) {
            displayIceCandidatesQr();
        }
      } else {
        console.log("All ICE candidates gathered for this phase.");
        if (currentAppState === AppState.EXCHANGING_CANDIDATES) {
            displayIceCandidatesQr();
        }
      }
    };

    // DataChannel reception
    peerConnection.ondatachannel = event => {
      console.log("Data channel received:", event.channel.label);
      dataChannel = event.channel;
      setupDataChannelEvents(); // Setup handlers for the received channel
    };

    // Media track reception
    peerConnection.ontrack = (event) => {
      console.log("Track received:", event.track.kind);
      if (remoteVideoElement && event.streams && event.streams[0]) {
        if (!remoteVideoElement.srcObject) {
          remoteVideoElement.srcObject = new MediaStream();
        }
        remoteVideoElement.srcObject.addTrack(event.track);
        console.log(`Track ${event.track.id} added to remote video.`);
      } else {
          console.warn("Remote video element not found or stream missing in ontrack event.");
      }
    };

    // Connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log("PeerConnection state:", peerConnection.connectionState);
      switch (peerConnection.connectionState) {
        case 'connected':
          if (currentAppState !== AppState.CONNECTED) {
              currentAppState = AppState.CONNECTED;
              updateStatus('Connection established!', 'green');
              showQrCode(false);
              showQrScanner(false);
              processReceivedIceCandidates();
          }
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          if (currentAppState !== AppState.INITIAL && currentAppState !== AppState.ERROR) {
              updateStatus(`Connection lost or failed (${peerConnection.connectionState})`, 'red');
              resetConnection();
          }
          break;
        case 'connecting':
          if (currentAppState !== AppState.CONNECTING && currentAppState !== AppState.CONNECTED) {
              updateStatus('Connecting...', 'orange');
          }
          break;
        default:
            if (currentAppState !== AppState.CONNECTED) {
                 updateStatus(`Connection state: ${peerConnection.connectionState}`, 'orange');
            }
      }
    };

    console.log("PeerConnection created.");
    return true;
  } catch (error) {
    console.error("Error creating PeerConnection:", error);
    updateStatus(`PeerConnection setup error: ${error.message}`, 'red');
    currentAppState = AppState.ERROR;
    return false;
  }
}

// Setup DataChannel event handlers (including binary type for files)
function setupDataChannelEvents() {
    if (!dataChannel) return;
    console.log(`Setting up DataChannel event handlers for channel: ${dataChannel.label}`);
    // Ensure binary data is handled as ArrayBuffer for file chunks
    dataChannel.binaryType = 'arraybuffer';

    dataChannel.onmessage = handleDataChannelMessage; // Handles text and binary
    dataChannel.onopen = () => {
        console.log(`Data channel '${dataChannel.label}' opened!`);
        if (currentAppState !== AppState.CONNECTED) {
             currentAppState = AppState.CONNECTED;
             updateStatus('Connected! (DataChannel Ready)', 'green');
             showQrCode(false);
             showQrScanner(false);
        }
        // Add buffer handling for file transfer flow control
        dataChannel.bufferedAmountLowThreshold = MAX_BUFFERED_AMOUNT / 2; // Example threshold
        console.log(`DataChannel buffer threshold set to: ${dataChannel.bufferedAmountLowThreshold}`);
    };
    dataChannel.onclose = () => {
        console.log(`Data channel '${dataChannel.label}' closed.`);
        if (currentAppState === AppState.CONNECTED) {
            updateStatus('Data connection closed', 'red');
            resetConnection();
        }
    };
    dataChannel.onerror = (error) => {
        console.error(`Data channel '${dataChannel.label}' error:`, error);
        updateStatus(`Data channel error: ${error}`, 'red');
        resetConnection();
    };
    // Handle buffer becoming low (for resuming file transfer)
    dataChannel.onbufferedamountlow = () => {
        console.log(`DataChannel buffer amount low: ${dataChannel.bufferedAmount}. Resuming send.`);
        // If we were paused sending a file, resume here
        if (sendingFileMeta && fileToSend) {
            sendFileChunk(); // Try sending the next chunk
        }
    };
}

// Create Offer, set Local Description, return Offer SDP
async function createOfferAndSetLocal() {
  if (!peerConnection) return null;
  console.log("Creating DataChannel 'cybernetcall-data'...");
  try {
    dataChannel = peerConnection.createDataChannel('cybernetcall-data', { negotiated: false });
    setupDataChannelEvents(); // Setup handlers *before* offer creation

    console.log("Creating Offer...");
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log("Offer created and local description set.");
    return peerConnection.localDescription;
  } catch (error) {
    console.error("Error creating DataChannel, Offer or setting local description:", error);
    updateStatus(`Offer creation error: ${error.message}`, 'red');
    currentAppState = AppState.ERROR;
    return null;
  }
}

// Handle received Offer, create Answer, set Local Description, return Answer SDP
async function handleOfferAndCreateAnswer(offerSdp) {
  if (!peerConnection) return null;
  console.log("Received offer, setting remote description...");
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
    console.log("Remote description set with Offer. Creating Answer...");
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log("Answer created and local description set.");
    processReceivedIceCandidates();
    return peerConnection.localDescription;
  } catch (error) {
    console.error("Error handling offer or creating/setting answer:", error);
    updateStatus(`Offer/Answer error: ${error.message}`, 'red');
    currentAppState = AppState.ERROR;
    return null;
  }
}

// Handle received Answer, set Remote Description
async function handleAnswer(answerSdp) {
  if (!peerConnection || !peerConnection.localDescription) return false;
  console.log("Received answer, setting remote description...");
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
    console.log("Remote description set with Answer.");
    processReceivedIceCandidates();
    return true;
  } catch (error) {
    console.error("Error setting remote description with answer:", error);
    updateStatus(`Answer processing error: ${error.message}`, 'red');
    currentAppState = AppState.ERROR;
    return false;
  }
}

// Add received ICE candidate (queue if needed)
async function handleIceCandidate(candidate) {
    if (!peerConnection || !peerConnection.remoteDescription) {
        console.warn("PeerConnection or remote description not ready, queuing received ICE candidate.");
        receivedIceCandidatesQueue.push(candidate);
        return;
    }
    console.log("Adding received ICE candidate:", candidate);
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("ICE candidate added successfully.");
    } catch (error) {
        if (error.message.includes("candidate cannot be added")) {
            console.warn("Ignoring error adding ICE candidate (possibly late or duplicate):", error.message);
        } else {
            console.error("Error adding received ICE candidate:", error);
        }
    }
}

// Process any queued received ICE candidates
function processReceivedIceCandidates() {
    console.log(`Processing ${receivedIceCandidatesQueue.length} queued ICE candidates.`);
    while (receivedIceCandidatesQueue.length > 0) {
        const candidate = receivedIceCandidatesQueue.shift();
        handleIceCandidate(candidate);
    }
}

// Display local ICE candidates in QR code
function displayIceCandidatesQr() {
    if (iceCandidatesQueue.length > 0) {
        console.log(`Displaying QR for ${iceCandidatesQueue.length} ICE candidates.`);
        const candidateData = {
            type: 'iceCandidates',
            candidates: iceCandidatesQueue,
            senderId: myDeviceId
        };
        updateQrCodeWithValue(JSON.stringify(candidateData));
        updateStatus(`Show this QR to your peer to exchange connection details (${iceCandidatesQueue.length} candidates).`, 'blue');
        showQrCode(true);
        showQrScanner(false);
    } else {
        console.log("No more local ICE candidates to display in QR.");
    }
}

// Reset connection state and UI
function resetConnection() {
    console.log("Resetting connection state...");
    stopQrScanner();

    if (dataChannel) dataChannel.close();
    if (peerConnection) peerConnection.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        if(localVideoElement) localVideoElement.srcObject = null;
        if(callButton) callButton.textContent = '📞 Call';
        if(videoButton) {
            videoButton.style.display = 'none';
            videoButton.textContent = '🎥 Video On';
        }
    }
    if (remoteVideoElement) remoteVideoElement.srcObject = null;

    peerConnection = null;
    dataChannel = null;
    peerId = null;
    iceCandidatesQueue = [];
    receivedIceCandidatesQueue = [];
    fileToSend = null; // Reset file transfer state
    sendingFileMeta = null;
    receivingFileMeta = {};
    if (fileTransferAreaElement) fileTransferAreaElement.innerHTML = ''; // Clear file transfer UI

    currentAppState = AppState.INITIAL;

    updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
    showQrCode(true);
    showQrScanner(true);
    updateStatus('Waiting for connection. Scan peer QR or show yours.', 'black');
}


// ==================================================
//  DataChannel Communication Handling (Text & Files)
// ==================================================

// Handle incoming DataChannel messages (Text or Binary)
function handleDataChannelMessage(event) {
  if (typeof event.data === 'string') {
    // Handle text messages (JSON)
    try {
      const message = JSON.parse(event.data);
      console.log("Received JSON message:", message.type);
      switch (message.type) {
          case 'post':
              savePost(message);
              displayPost(message, true);
              break;
          case 'direct-message':
              displayDirectMessage(message, false);
              break;
          case 'file-meta': // Received metadata about an incoming file
              handleFileMeta(message);
              break;
          case 'file-end': // Received signal that file transfer is complete
              handleFileEnd(message);
              break;
          // Add other text message types if needed
          default:
              console.warn("Received unknown message type:", message.type);
      }
    } catch (error) {
        console.error("Error parsing received JSON data:", error, event.data);
    }
  } else if (event.data instanceof ArrayBuffer) {
    // Handle binary messages (File Chunks)
    handleFileChunk(event.data);
  } else {
      console.warn("Received unexpected data type:", typeof event.data);
  }
}

// Send a direct message
function handleSendMessage() {
    // --- Hypothetical Billing Check ---
    // if (!userHasPaid && messageCount > FREE_LIMIT) {
    //    showPaymentWindow();
    //    return;
    // }
    // --- End Hypothetical Billing Check ---

    const input = document.getElementById('messageInput');
    const content = input?.value.trim();
    if (content && dataChannel && dataChannel.readyState === 'open') {
        const message = {
            type: 'direct-message',
            content: content,
            sender: myDeviceId,
            timestamp: new Date().toISOString()
        };
        try {
            dataChannel.send(JSON.stringify(message));
            displayDirectMessage(message, true);
            if(input) input.value = '';
        } catch (error) {
            console.error("Error sending message:", error);
            updateStatus(`Error sending message: ${error.message}`, 'red');
        }
    } else if (!dataChannel || dataChannel.readyState !== 'open') {
        alert("Cannot send message: Not connected or data channel not open.");
    }
}

function displayDirectMessage(message, isOwnMessage = false) { /* ... (No changes) ... */ }
async function handleSendPost() { /* ... (No changes) ... */ }
// (Copy implementations from the previous provided code if needed)
// Display a direct message in the message area
function displayDirectMessage(message, isOwnMessage = false) {
    if (!messageAreaElement) return;
    const div = document.createElement('div');
    div.classList.add('message', isOwnMessage ? 'own-message' : 'peer-message');
    div.innerHTML = `<strong>${isOwnMessage ? 'You' : (message.sender ? message.sender.substring(0, 6) : 'Peer')}:</strong> ${message.content}`;
    messageAreaElement.appendChild(div);
    messageAreaElement.scrollTop = messageAreaElement.scrollHeight;
}

// Send a post
async function handleSendPost() {
  const input = document.getElementById('postInput');
  const content = input?.value.trim();
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
    if (dataChannel && dataChannel.readyState === 'open') {
      try {
          dataChannel.send(JSON.stringify(post));
          console.log("Post sent via DataChannel:", post.id);
      } catch (error) {
          console.error("Error sending post:", error);
          updateStatus(`Error sending post: ${error.message}`, 'red');
      }
    } else {
        console.log("Post saved locally, but not sent (no open DataChannel).");
    }
    if(input) input.value = '';
  }
}


// ==================================================
//  File Transfer Functions
// ==================================================

// Called when the file input changes
function handleFileSelection(event) {
    const files = event.target.files;
    if (files.length > 0) {
        fileToSend = files[0];
        console.log(`File selected: ${fileToSend.name}, size: ${fileToSend.size} bytes`);
        // Enable send button or update UI
        if (sendFileButton) sendFileButton.disabled = false;
        updateFileTransferStatus(null, `Selected: ${fileToSend.name} (${formatBytes(fileToSend.size)})`);
    } else {
        fileToSend = null;
        if (sendFileButton) sendFileButton.disabled = true;
        updateFileTransferStatus(null, ''); // Clear status
    }
}

// Called when the "Send File" button is clicked
function handleSendFile() {
    if (!fileToSend) {
        alert("Please select a file first.");
        return;
    }
    if (!dataChannel || dataChannel.readyState !== 'open') {
        alert("Cannot send file: Not connected.");
        return;
    }
    if (sendingFileMeta) {
        alert("Already sending a file. Please wait.");
        return;
    }

    console.log(`Initiating file transfer for: ${fileToSend.name}`);
    const fileId = generateUUID(); // Unique ID for this transfer
    sendingFileMeta = {
        id: fileId,
        name: fileToSend.name,
        size: fileToSend.size,
        type: fileToSend.type || 'application/octet-stream', // Default type
        currentChunk: 0
    };

    // 1. Send file metadata
    const metaMessage = { type: 'file-meta', ...sendingFileMeta };
    try {
        dataChannel.send(JSON.stringify(metaMessage));
        updateFileTransferStatus(fileId, `Sending ${sendingFileMeta.name}: 0%`);
        console.log("Sent file metadata:", sendingFileMeta);

        // 2. Start sending chunks (after a short delay to allow meta processing)
        setTimeout(sendFileChunk, 100); // Start chunk sending

    } catch (error) {
        console.error("Error sending file metadata:", error);
        updateStatus(`Error starting file transfer: ${error.message}`, 'red');
        sendingFileMeta = null; // Reset state on error
    }
}

// Send the next file chunk
function sendFileChunk() {
    if (!sendingFileMeta || !fileToSend) return;

    // Check buffer amount - pause if too high
    if (dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        console.log(`DataChannel buffer full (${dataChannel.bufferedAmount}). Pausing send.`);
        updateFileTransferStatus(sendingFileMeta.id, `Sending ${sendingFileMeta.name}: Paused (Buffer Full)`);
        // Wait for onbufferedamountlow event to trigger next sendFileChunk
        return;
    }

    const offset = sendingFileMeta.currentChunk * CHUNK_SIZE;
    if (offset >= fileToSend.size) {
        // All chunks sent
        console.log(`All chunks sent for file: ${sendingFileMeta.name}`);
        const endMessage = { type: 'file-end', id: sendingFileMeta.id };
        dataChannel.send(JSON.stringify(endMessage));
        updateFileTransferStatus(sendingFileMeta.id, `Sent ${sendingFileMeta.name} successfully!`);
        sendingFileMeta = null; // Mark sending as complete
        fileToSend = null; // Clear selected file
        if (fileInputElement) fileInputElement.value = ''; // Clear file input
        if (sendFileButton) sendFileButton.disabled = true;
        return;
    }

    const slice = fileToSend.slice(offset, offset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = (event) => {
        if (dataChannel.readyState === 'open') {
            try {
                dataChannel.send(event.target.result); // Send ArrayBuffer chunk
                sendingFileMeta.currentChunk++;
                const progress = Math.min(100, Math.round((sendingFileMeta.currentChunk * CHUNK_SIZE / fileToSend.size) * 100));
                updateFileTransferStatus(sendingFileMeta.id, `Sending ${sendingFileMeta.name}: ${progress}%`);

                // Send next chunk immediately if buffer allows
                // Use setTimeout to avoid blocking the event loop completely
                setTimeout(sendFileChunk, 0);

            } catch (error) {
                console.error(`Error sending chunk ${sendingFileMeta.currentChunk}:`, error);
                updateStatus(`Error sending file chunk: ${error.message}`, 'red');
                updateFileTransferStatus(sendingFileMeta.id, `Error sending ${sendingFileMeta.name}`);
                sendingFileMeta = null; // Abort transfer on error
            }
        } else {
            console.warn("DataChannel closed while sending file. Aborting.");
            updateFileTransferStatus(sendingFileMeta.id, `Failed to send ${sendingFileMeta.name} (Connection lost)`);
            sendingFileMeta = null;
        }
    };

    reader.onerror = (error) => {
        console.error("FileReader error:", error);
        updateStatus(`Error reading file: ${error.message}`, 'red');
        updateFileTransferStatus(sendingFileMeta.id, `Error reading ${sendingFileMeta.name}`);
        sendingFileMeta = null;
    };

    reader.readAsArrayBuffer(slice);
}

// Handle received file metadata
function handleFileMeta(meta) {
    const fileId = meta.id;
    console.log(`Received metadata for file: ${meta.name} (ID: ${fileId})`);
    receivingFileMeta[fileId] = {
        id: fileId,
        name: meta.name,
        size: meta.size,
        type: meta.type,
        receivedSize: 0,
        chunks: []
    };
    updateFileTransferStatus(fileId, `Receiving ${meta.name}: 0%`);
    // Optionally, send an acknowledgement back to the sender
}

// Handle received file chunk (ArrayBuffer)
function handleFileChunk(chunk) {
    // Find which file this chunk belongs to (requires sender to send fileId with chunk, or assume only one transfer at a time)
    // For simplicity, let's assume only one file transfer happens at a time or find the active one.
    let activeFileId = null;
    for (const id in receivingFileMeta) {
        // Find the file that hasn't finished receiving yet
        if (receivingFileMeta[id] && receivingFileMeta[id].receivedSize < receivingFileMeta[id].size) {
            activeFileId = id;
            break;
        }
    }

    if (!activeFileId || !receivingFileMeta[activeFileId]) {
        console.warn("Received a file chunk but no matching metadata found or transfer complete. Ignoring.");
        return;
    }

    const fileInfo = receivingFileMeta[activeFileId];
    fileInfo.chunks.push(chunk);
    fileInfo.receivedSize += chunk.byteLength;

    const progress = Math.min(100, Math.round((fileInfo.receivedSize / fileInfo.size) * 100));
    updateFileTransferStatus(activeFileId, `Receiving ${fileInfo.name}: ${progress}%`);

    // console.log(`Received chunk for ${fileInfo.name}. Total received: ${fileInfo.receivedSize}/${fileInfo.size}`);
}

// Handle file transfer end signal
function handleFileEnd(endMsg) {
    const fileId = endMsg.id;
    if (!receivingFileMeta[fileId]) {
        console.warn(`Received file-end signal for unknown or completed ID: ${fileId}`);
        return;
    }

    const fileInfo = receivingFileMeta[fileId];
    console.log(`File transfer complete signal received for: ${fileInfo.name}`);

    if (fileInfo.receivedSize === fileInfo.size) {
        console.log(`Assembling file: ${fileInfo.name}`);
        try {
            const fileBlob = new Blob(fileInfo.chunks, { type: fileInfo.type });
            const downloadUrl = URL.createObjectURL(fileBlob);

            // Create download link
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = fileInfo.name;
            link.textContent = `Download ${fileInfo.name} (${formatBytes(fileInfo.size)})`;
            link.style.display = 'block'; // Ensure link is visible
            link.style.marginTop = '5px';

            // Update or replace the status message with the download link
            updateFileTransferStatus(fileId, '', link); // Pass link as third argument

            // Clean up - remove file info after processing
            // delete receivingFileMeta[fileId]; // Keep info for display? Or clear after download? Let's keep it for now.

        } catch (error) {
            console.error("Error creating Blob or download link:", error);
            updateFileTransferStatus(fileId, `Error processing received file ${fileInfo.name}`);
        }
    } else {
        console.error(`File transfer ended for ${fileInfo.name}, but received size (${fileInfo.receivedSize}) does not match expected size (${fileInfo.size}).`);
        updateFileTransferStatus(fileId, `Error receiving ${fileInfo.name} (Incomplete)`);
        // Clean up incomplete transfer data
        delete receivingFileMeta[fileId];
    }
}

// Update file transfer UI
function updateFileTransferStatus(fileId, statusText, downloadLinkElement = null) {
    if (!fileTransferAreaElement) return;

    let statusElement = fileId ? fileTransferAreaElement.querySelector(`[data-file-id="${fileId}"]`) : null;

    if (!statusElement && fileId) {
        // Create a new status element if it doesn't exist
        statusElement = document.createElement('div');
        statusElement.dataset.fileId = fileId;
        statusElement.className = 'file-transfer-status';
        fileTransferAreaElement.appendChild(statusElement);
    } else if (!statusElement && !fileId && statusText) {
         // General status update (e.g., file selected) - find or create a general status line
         statusElement = fileTransferAreaElement.querySelector('.file-transfer-general-status');
         if (!statusElement) {
             statusElement = document.createElement('div');
             statusElement.className = 'file-transfer-general-status';
             fileTransferAreaElement.appendChild(statusElement);
         }
    }


    if (statusElement) {
        // Clear previous content before adding new status/link
        statusElement.innerHTML = '';
        if (statusText) {
            const textNode = document.createTextNode(statusText);
            statusElement.appendChild(textNode);
        }
        if (downloadLinkElement) {
            // Add a line break if there was status text
            if (statusText) statusElement.appendChild(document.createElement('br'));
            statusElement.appendChild(downloadLinkElement);
        }
    }
}

// Helper to format bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


// ==================================================
//  Media Handling (Video Call)
// ==================================================
async function toggleVideoCall() { /* ... (No changes) ... */ }
function toggleLocalVideo() { /* ... (No changes) ... */ }
// (Copy implementations from the previous provided code if needed)
// Toggle video call start/stop
async function toggleVideoCall() {
    if (!peerConnection || (currentAppState !== AppState.CONNECTED && currentAppState !== AppState.WAITING_FOR_CONNECTION)) { // Allow starting call slightly before full connection
        alert("Please establish a connection first.");
        return;
    }

    if (!localStream) { // Start call
        console.log("Starting video call...");
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideoElement) localVideoElement.srcObject = localStream;

            localStream.getTracks().forEach(track => {
                try {
                    if (!peerConnection.getSenders().find(s => s.track === track)) {
                        peerConnection.addTrack(track, localStream);
                        console.log(`Added track ${track.kind} (${track.id}).`);
                    }
                } catch (e) { console.error("Error adding track:", e); }
            });

            if(callButton) callButton.textContent = 'End Call';
            if(videoButton) videoButton.style.display = 'inline-block';
            updateStatus("Video call started.", "green");
            console.warn("Video tracks added. Renegotiation might be needed.");

        } catch (error) {
            console.error("Error starting video call:", error);
            alert(`Media access error: ${error.message}`);
            if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
            if(localVideoElement) localVideoElement.srcObject = null;
        }
    } else { // End call
        console.log("Ending video call...");
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;

        peerConnection.getSenders().forEach(sender => {
            if (sender.track) {
                try { peerConnection.removeTrack(sender); console.log(`Removed track ${sender.track.kind}.`); }
                catch (e) { console.error("Error removing track:", e); }
            }
        });

        if(localVideoElement) localVideoElement.srcObject = null;
        if(callButton) callButton.textContent = '📞 Call';
        if(videoButton) { videoButton.style.display = 'none'; videoButton.textContent = '🎥 Video On'; }
        updateStatus("Video call ended.", "black");
    }
}

// Toggle local video stream on/off
function toggleLocalVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            if(videoButton) videoButton.textContent = videoTrack.enabled ? '🎥 Video On' : '🚫 Video Off';
            console.log(`Local video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
        }
    }
}


// ==================================================
//  QR Code Handling
// ==================================================
function updateQrCodeWithValue(value) { /* ... (No changes) ... */ }
function startQrScanner() { /* ... (No changes) ... */ }
async function handleScannedQrData(decodedText) { /* ... (No changes) ... */ }
function startIceCandidateExchangePhase() { /* ... (No changes) ... */ }
// (Copy implementations from the previous provided code if needed)
// Update QR code element
function updateQrCodeWithValue(value) {
    if (!qrElement) return;
    const size = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.4, 300);
    if (typeof QRious !== 'undefined') {
        try {
            new QRious({ element: qrElement, value: value || '', size: size, level: 'L' }); // Use 'L' for larger data
            let logValue = value ? `type: ${JSON.parse(value).type}, size: ${value.length}` : "empty";
            console.log("QR Code updated:", logValue);
        } catch (e) {
             console.error("QRious error:", e);
             qrElement.textContent = "Error generating QR code.";
        }
    } else {
        console.error("QRious library not loaded.");
        qrElement.textContent = "QR library missing.";
        setTimeout(() => updateQrCodeWithValue(value), 1000);
    }
}

// Start QR code scanner
function startQrScanner() {
    if (currentAppState === AppState.CONNECTED) { showQrScanner(false); return; }
    if (!qrReaderElement) return;
    try {
        if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.getState === 'function' && window.html5QrCodeScanner.getState() === 2) {
            qrReaderElement.style.display = 'block'; return; // Already running
        }
    } catch(e) { /* ignore */ }

    if (typeof Html5Qrcode !== 'undefined') {
        stopQrScanner();
        window.html5QrCodeScanner = new Html5Qrcode("qr-reader");
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            console.log(`QR Scan successful: ${decodedText.substring(0, 50)}...`);
            if (qrResultsElement) {
                qrResultsElement.textContent = `Scan successful! Processing...`;
                qrResultsElement.style.display = 'block';
                setTimeout(() => { if(qrResultsElement) qrResultsElement.style.display = 'none'; }, 2000);
            }
            handleScannedQrData(decodedText);
        };
        const config = { fps: 5, qrbox: (w, h) => ({ width: Math.min(w,h)*0.7, height: Math.min(w,h)*0.7 }), rememberLastUsedCamera: true };
        console.log("Starting QR scanner...");
        qrReaderElement.style.display = 'block';
        window.html5QrCodeScanner.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
            .catch(err => {
                console.error(`QR Scanner start error: ${err}`);
                updateStatus(`QR Scanner Error: ${err.message}`, 'red');
                qrReaderElement.style.display = 'none';
            });
    } else {
        console.error("Html5Qrcode library not loaded.");
        updateStatus("QR Scanner library missing.", "red");
        setTimeout(startQrScanner, 1000);
    }
}

// Process scanned QR data (Offer/Answer/ICE Candidates)
async function handleScannedQrData(decodedText) {
    console.log("Handling scanned data:", decodedText.substring(0,50) + "...");
    try {
        const data = JSON.parse(decodedText);
        console.log("Parsed data type:", data.type);
        if (currentAppState === AppState.CONNECTED) return; // Ignore if connected

        // State-based Handling
        if (data.type === 'initial' && currentAppState === AppState.INITIAL) {
            peerId = data.deviceId;
            updateStatus(`Peer recognized (${peerId.substring(0,6)}...). Creating Offer...`, 'orange');
            currentAppState = AppState.CREATING_OFFER;
            showQrScanner(false);
            if (await createPeerConnection()) {
                const offerSdp = await createOfferAndSetLocal();
                if (offerSdp) {
                    updateQrCodeWithValue(JSON.stringify({ type: 'offer', sdp: offerSdp, senderId: myDeviceId }));
                    updateStatus('Offer created. Show this QR to your peer.', 'blue');
                    showQrCode(true);
                    currentAppState = AppState.WAITING_FOR_ANSWER;
                } else { resetConnection(); }
            } else { resetConnection(); }
        }
        else if (data.type === 'offer' && currentAppState === AppState.INITIAL) {
            peerId = data.senderId;
            updateStatus(`Received Offer from ${peerId.substring(0,6)}. Creating Answer...`, 'orange');
            currentAppState = AppState.PROCESSING_OFFER;
            showQrScanner(false);
            if (await createPeerConnection()) {
                const answerSdp = await handleOfferAndCreateAnswer(data.sdp);
                if (answerSdp) {
                    updateQrCodeWithValue(JSON.stringify({ type: 'answer', sdp: answerSdp, senderId: myDeviceId }));
                    updateStatus('Answer created. Show this QR to your peer.', 'blue');
                    showQrCode(true);
                    currentAppState = AppState.WAITING_FOR_CONNECTION;
                    startIceCandidateExchangePhase();
                } else { resetConnection(); }
            } else { resetConnection(); }
        }
        else if (data.type === 'answer' && currentAppState === AppState.WAITING_FOR_ANSWER) {
            updateStatus(`Received Answer from ${data.senderId.substring(0,6)}. Processing...`, 'orange');
            showQrCode(false);
            if (await handleAnswer(data.sdp)) {
                updateStatus('Answer processed. Waiting for connection...', 'blue');
                currentAppState = AppState.WAITING_FOR_CONNECTION;
                startIceCandidateExchangePhase();
            } else { resetConnection(); }
        }
        else if (data.type === 'iceCandidates' && currentAppState === AppState.EXCHANGING_CANDIDATES) {
            updateStatus(`Received ${data.candidates.length} ICE candidate(s) from ${data.senderId.substring(0,6)}. Adding...`, 'orange');
            for (const candidate of data.candidates) { await handleIceCandidate(candidate); }
            showQrScanner(true); // Keep scanner open for more candidates
        }
        else {
            console.warn(`Unexpected data type '${data.type}' in state '${currentAppState}'`);
            updateStatus(`Unexpected scan (${data.type} in state ${currentAppState}). Please follow the steps.`, 'orange');
        }
    } catch (error) {
        console.error("Error handling scanned data:", error);
        updateStatus(error instanceof SyntaxError ? `QR Scan Error: Invalid data format.` : `QR data processing error: ${error.message}`, 'red');
    }
}

// Transition to ICE candidate exchange phase
function startIceCandidateExchangePhase() {
    console.log("Transitioning to ICE candidate exchange phase.");
    currentAppState = AppState.EXCHANGING_CANDIDATES;
    updateStatus("Connection details (SDP) exchanged. Now exchanging network candidates...", "blue");
    displayIceCandidatesQr(); // Show our candidate QR
    showQrScanner(true); // Show scanner to receive peer's candidates
}


// ==================================================
//  Event Listener Setup
// ==================================================
function setupEventListeners() {
    // Resize event
    window.addEventListener('resize', () => {
        if (qrElement && qrElement.style.display !== 'none') {
            let qrValue = null;
            try {
                if (currentAppState === AppState.WAITING_FOR_ANSWER && peerConnection?.localDescription) {
                    qrValue = JSON.stringify({ type: 'offer', sdp: peerConnection.localDescription, senderId: myDeviceId });
                } else if (currentAppState === AppState.WAITING_FOR_CONNECTION && peerConnection?.localDescription?.type === 'answer') {
                     qrValue = JSON.stringify({ type: 'answer', sdp: peerConnection.localDescription, senderId: myDeviceId });
                } else if (currentAppState === AppState.EXCHANGING_CANDIDATES && iceCandidatesQueue.length > 0) {
                     qrValue = JSON.stringify({ type: 'iceCandidates', candidates: iceCandidatesQueue, senderId: myDeviceId });
                } else if (currentAppState === AppState.INITIAL) {
                     qrValue = JSON.stringify({ type: 'initial', deviceId: myDeviceId });
                }
                if (qrValue) updateQrCodeWithValue(qrValue);
            } catch (e) { console.error("Error creating QR value on resize:", e); }
        }
    });

    // Button events
    document.getElementById('sendMessage')?.addEventListener('click', handleSendMessage);
    document.getElementById('sendPost')?.addEventListener('click', handleSendPost);
    callButton?.addEventListener('click', toggleVideoCall);
    videoButton?.addEventListener('click', toggleLocalVideo);
    sendFileButton?.addEventListener('click', handleSendFile);

    // File input change event
    fileInputElement?.addEventListener('change', handleFileSelection);

    // Input field Enter key listeners
    document.getElementById('messageInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } });
    document.getElementById('postInput')?.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendPost(); } });

    console.log("Event listeners set up.");
}

// ==================================================
//  Initialization (on DOMContentLoaded)
// ==================================================
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM fully loaded. Initializing app...");

  // 0. Get UI element references
  qrElement = document.getElementById('qrcode');
  statusElement = document.getElementById('connectionStatus');
  qrReaderElement = document.getElementById('qr-reader');
  qrResultsElement = document.getElementById('qr-reader-results');
  localVideoElement = document.getElementById('localVideo');
  remoteVideoElement = document.getElementById('remoteVideo');
  messageAreaElement = document.getElementById('messageArea');
  postAreaElement = document.getElementById('postArea');
  callButton = document.getElementById('callButton');
  videoButton = document.getElementById('videoButton');
  fileInputElement = document.getElementById('fileInput');
  sendFileButton = document.getElementById('sendFileButton'); // Changed ID
  fileTransferAreaElement = document.getElementById('fileTransferArea'); // Added

  // Initial state for file button
  if (sendFileButton) sendFileButton.disabled = true;

  // 1. Generate ID, 2. Load Posts, 3. Setup Listeners
  myDeviceId = generateUUID(); console.log("My Device ID:", myDeviceId);
  displayInitialPosts();
  setupEventListeners();

  // 4. Display initial QR and status
  updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
  updateStatus('Waiting for connection. Scan peer QR or show yours.', 'black');
  showQrCode(true);

  // 5. Start QR scanner
  showQrScanner(true);

  // 6. Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/cnc/service-worker.js')
      .then(reg => { console.log('Service Worker registered:', reg.scope); /* ... update logic ... */ })
      .catch(err => { console.error('Service Worker registration failed:', err); updateStatus(`SW Error: ${err.message}`, 'red'); });
  } else {
    console.log("Service Worker not supported.");
    updateStatus('Offline features unavailable (Service Worker not supported)', 'orange');
  }

  console.log("App initialization complete.");
  currentAppState = AppState.INITIAL;
});
