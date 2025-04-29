// /home/my/d/cybernetcall/cnc/static/cnc/app.js
// Final version with English UI messages, DOMPurify, File Transfer, Post Deletion, modified Call Buttons, and Manual QR Scan Start

// ==================================================
// Global Variables & State Management
// ==================================================
let myDeviceId; // Unique ID for this device
let selectedFriendId; // ID of the peer being connected to
let peerConnection; // RTCPeerConnection instance
let dataChannel; // RTCDataChannel instance
let localStream; // User's camera/microphone stream

// Application states
const AppState = {
  INITIAL: 'initial', // Waiting for connection
  CONNECTING: 'connecting', // Exchanging Offer/Answer
  CONNECTED: 'connected', // Connection established
  ERROR: 'error' // An error occurred
};
let currentAppState = AppState.INITIAL;

// UI element references (obtained in DOMContentLoaded)
let qrElement, statusElement, qrReaderElement, qrResultsElement, localVideoElement, remoteVideoElement, messageAreaElement, postAreaElement;
let messageInputElement, sendMessageButton, postInputElement, sendPostButton; // Chat UI elements
let fileInputElement, sendFileButton, fileTransferStatusElement; // File transfer UI elements
let callButton, videoButton; // Video call UI elements
let startScanButton; // QR Scan Button

// File Transfer Globals
const CHUNK_SIZE = 16384; // 16KB chunk size
let fileReader;
let receiveBuffer = {}; // Buffer for incoming file chunks, keyed by fileId
let receivedSize = {}; // Received size for each file, keyed by fileId
let incomingFileInfo = {}; // Info about incoming files, keyed by fileId

// IndexedDB Promise (requires idb library)
let dbPromise = typeof idb !== 'undefined' ? idb.openDB('cybernetcall-db', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('posts')) {
      db.createObjectStore('posts', { keyPath: 'id' });
    }
    // Add other stores here if needed
  }
}) : null; // null if idb is not loaded

if (!dbPromise) {
    console.error("idb library not loaded. IndexedDB features will be unavailable.");
}

// ==================================================
// Utility Functions
// ==================================================

// Generate a UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper to update the status message UI
function updateStatus(message, color = 'black') {
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.color = color;
        statusElement.style.display = message ? 'block' : 'none'; // Show if message exists
    }
    console.log(`Status Update: ${message} (State: ${currentAppState})`);
}

// Helper to enable/disable chat and call UI elements
function setInteractionUiEnabled(enabled) {
    const disabled = !enabled;
    // Chat Inputs and Buttons
    if (messageInputElement) messageInputElement.disabled = disabled;
    if (sendMessageButton) sendMessageButton.disabled = disabled;
    if (postInputElement) postInputElement.disabled = disabled;
    if (sendPostButton) sendPostButton.disabled = disabled;
    // File Transfer Inputs and Buttons
    if (fileInputElement) fileInputElement.disabled = disabled;
    if (sendFileButton) sendFileButton.disabled = disabled;
    // Call Control Buttons
    if (callButton) callButton.disabled = disabled;
    if (videoButton) videoButton.disabled = disabled;

    // Also control the scan button based on connection state
    if (startScanButton) {
        // Only enable scan button if in INITIAL state
        startScanButton.disabled = (currentAppState !== AppState.INITIAL);
    }

    console.log(`Interaction UI (Chat, File, Call, Scan) ${enabled ? 'enabled' : 'disabled'}.`);
}

// ==================================================
// IndexedDB Operations
// ==================================================
// Save a post to IndexedDB
async function savePost(post) {
  if (!dbPromise) return; // Do nothing if idb is not available
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

// Delete a post from IndexedDB by ID
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


// Display initial posts from IndexedDB on startup
async function displayInitialPosts() {
  if (!dbPromise || !postAreaElement) return;
  try {
    const db = await dbPromise;
    const posts = await db.getAll('posts');
    postAreaElement.innerHTML = ''; // Clear existing posts
    // Sort posts by timestamp (newest first) if timestamp exists
    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    posts.forEach(post => displayPost(post, false)); // Display each post (not marked as new)
    console.log(`Displayed ${posts.length} initial posts.`);
  } catch (error) {
    console.error("Error displaying initial posts:", error);
  }
}

// Display a single post (new or received) and add delete button
function displayPost(post, isNew = true) {
  if (!postAreaElement) return;
  const div = document.createElement('div');
  div.className = 'post';
  div.id = `post-${post.id}`; // Add ID to the div for easy removal

  // Create content span
  const contentSpan = document.createElement('span');
  // Create HTML string including sender (shortened) and content
  // ★ XSS Protection: Sanitize HTML before setting innerHTML
  const unsafeHTML = `<strong>${post.sender ? post.sender.substring(0, 6) : 'Unknown'}:</strong> ${post.content}`;
  contentSpan.innerHTML = DOMPurify.sanitize(unsafeHTML); // Sanitize using DOMPurify

  // Create delete button
  const deleteButton = document.createElement('button');
  deleteButton.textContent = '❌'; // Or use an icon/image
  deleteButton.className = 'delete-post-button'; // Add class for styling
  deleteButton.dataset.postId = post.id; // Store post ID on the button
  deleteButton.style.marginLeft = '10px'; // Add some spacing
  deleteButton.style.cursor = 'pointer';
  deleteButton.style.border = 'none';
  deleteButton.style.background = 'none';
  deleteButton.ariaLabel = 'Delete post';
  deleteButton.addEventListener('click', handleDeletePost); // Add click listener

  // Append content and button to the post div
  div.appendChild(contentSpan);
  div.appendChild(deleteButton);

  // Add the new post element to the top (if new) or bottom
  if (isNew && postAreaElement.firstChild) {
      postAreaElement.insertBefore(div, postAreaElement.firstChild);
  } else {
      postAreaElement.appendChild(div);
  }
}

// Handle clicking the delete post button
async function handleDeletePost(event) {
    const button = event.currentTarget;
    const postId = button.dataset.postId;
    if (!postId) return;

    console.log("Attempting to delete post:", postId);

    // 1. Remove from UI
    const postElement = document.getElementById(`post-${postId}`);
    if (postElement) {
        postElement.remove();
    }

    // 2. Remove from IndexedDB
    await deletePostFromDb(postId);

    // 3. Notify peer if connected
    if (dataChannel && dataChannel.readyState === 'open') {
        try {
            const message = {
                type: 'delete-post',
                postId: postId
            };
            dataChannel.send(JSON.stringify(message));
            console.log("Delete notification sent for post:", postId);
        } catch (error) {
            console.error("Error sending delete notification:", error);
        }
    }
}


// ==================================================
// WebRTC Core Functions
// ==================================================

// Create PeerConnection and set up event handlers
async function createPeerConnection() {
  if (peerConnection) {
    console.warn("Closing existing PeerConnection.");
    peerConnection.close();
  }
  console.log("Creating PeerConnection...");
  try {
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // Google's STUN server
    });

    // Handle ICE Candidate generation
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        console.log('Generated ICE Candidate:', event.candidate);
        // Design Note: Exchanging ICE candidates via QR is complex.
        // This implementation does not automatically exchange them.
        console.warn("ICE candidate generated. Automatic exchange via QR not implemented.");
        // If using a signaling server, send the candidate here:
        // e.g., sendSignalingMessage({ type: 'iceCandidate', candidate: event.candidate });
      } else {
        console.log("All ICE candidates have been gathered."); // Indicates ICE gathering is complete
      }
    };

    // Handle receiving a data channel from the peer
    peerConnection.ondatachannel = event => {
      console.log("Data channel received:", event.channel.label);
      dataChannel = event.channel;
      // **Important:** Set binaryType for receiving ArrayBuffers (file chunks)
      dataChannel.binaryType = 'arraybuffer';
      setupDataChannelEvents(); // Set up handlers for the received channel
    };

    // Handle receiving media tracks (video/audio) from the peer
    peerConnection.ontrack = (event) => {
      console.log("Track received:", event.track.kind);
      if (remoteVideoElement && event.streams && event.streams[0]) {
        // Ensure remote video element has a srcObject
        if (!remoteVideoElement.srcObject) {
          remoteVideoElement.srcObject = new MediaStream();
        }
        // Add the received track to the remote video element's stream
        remoteVideoElement.srcObject.addTrack(event.track);
        console.log(`Track ${event.track.id} added to remote video.`);
      } else {
          console.warn("Remote video element not found or stream missing in ontrack event.");
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log("PeerConnection state:", peerConnection.connectionState);
      switch (peerConnection.connectionState) {
        case 'connected':
          // Connection established
          if (currentAppState !== AppState.CONNECTED) {
              currentAppState = AppState.CONNECTED;
              updateStatus('Connected!', 'green'); // ★ English
              if(qrElement) qrElement.style.display = 'none'; // Hide QR code
              if(qrReaderElement) qrReaderElement.style.display = 'none'; // Hide QR reader
              setInteractionUiEnabled(true); // Enable interaction UI
          }
          break;
        case 'disconnected': // Connection lost temporarily or permanently
        case 'failed': // Connection failed (e.g., NAT traversal issues)
        case 'closed': // Connection closed
          // If we were connected or connecting, reset to initial state
          if (currentAppState === AppState.CONNECTED || currentAppState === AppState.CONNECTING) {
              currentAppState = AppState.INITIAL;
              const reason = peerConnection.connectionState === 'failed' ? ' (Connection failed)' : ''; // ★ English
              updateStatus(`Connection closed (${peerConnection.connectionState}${reason})`, 'red'); // ★ English
              setInteractionUiEnabled(false); // Disable interaction UI
              resetConnection(); // Reset connection state and UI
          }
          break;
        case 'connecting': // Peers are exchanging information
          if (currentAppState !== AppState.CONNECTING) {
              currentAppState = AppState.CONNECTING;
              updateStatus('Connecting...', 'orange'); // ★ English
          }
          break;
        default: // Other states like 'new', 'checking'
            if (currentAppState !== AppState.CONNECTING && currentAppState !== AppState.CONNECTED) {
                 updateStatus(`Connection state: ${peerConnection.connectionState}`, 'orange'); // ★ English
            }
      }
    };
    console.log("PeerConnection created.");
    return true; // Success
  } catch (error) {
    console.error("Error creating PeerConnection:", error);
    updateStatus(`Connection setup error: ${error.message}`, 'red'); // ★ English
    currentAppState = AppState.ERROR;
    return false; // Failure
  }
}

// Set up event handlers for the RTCDataChannel
function setupDataChannelEvents() {
    if (!dataChannel) return;
    dataChannel.onmessage = handleDataChannelMessage; // Handle incoming messages
    dataChannel.onopen = () => {
        console.log("Data channel opened!");
        // When data channel opens, connection is fully established
        if (currentAppState !== AppState.CONNECTED) {
             currentAppState = AppState.CONNECTED;
             updateStatus('Connected! (DataChannel Ready)', 'green'); // ★ English
             if(qrElement) qrElement.style.display = 'none';
             if(qrReaderElement) qrReaderElement.style.display = 'none';
             setInteractionUiEnabled(true); // Enable interaction UI
        }
    };
    dataChannel.onclose = () => {
        console.log("Data channel closed.");
        // If data channel closes while connected, treat as disconnection
        if (currentAppState === AppState.CONNECTED) {
            currentAppState = AppState.INITIAL;
            updateStatus('Data channel closed', 'red'); // ★ English
            setInteractionUiEnabled(false); // Disable interaction UI
            resetConnection();
        }
    };
    dataChannel.onerror = (error) => {
        console.error("Data channel error:", error);
        currentAppState = AppState.ERROR;
        updateStatus(`Data channel error: ${error}`, 'red'); // ★ English
        setInteractionUiEnabled(false); // Disable interaction UI on error
        resetConnection();
    };
}

// Create Offer SDP and set as local description
async function createOfferAndSetLocal() {
  if (!peerConnection) {
      console.error("Cannot create offer: PeerConnection not ready.");
      return null;
  }
  console.log("Creating DataChannel 'cybernetcall-data'...");
  try {
    // Create the data channel (initiator side)
    dataChannel = peerConnection.createDataChannel('cybernetcall-data');
    // dataChannel.binaryType = 'arraybuffer'; // Usually default, but can be explicit
    setupDataChannelEvents(); // Set up handlers for the created channel

    console.log("Creating Offer...");
    const offer = await peerConnection.createOffer(); // Create SDP offer
    await peerConnection.setLocalDescription(offer); // Set offer as local description
    console.log("Offer created and local description set.");
    return peerConnection.localDescription; // Return the Offer SDP
  } catch (error) {
    console.error("Error creating DataChannel, Offer or setting local description:", error);
    updateStatus(`Offer creation error: ${error.message}`, 'red'); // ★ English
    currentAppState = AppState.ERROR;
    return null;
  }
}

// Handle received Offer SDP, create Answer, and set local description
async function handleOfferAndCreateAnswer(offerSdp) {
  if (!peerConnection) {
       console.error("Cannot handle offer: PeerConnection not ready.");
       return null;
  }
  console.log("Received offer, setting remote description...");
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp)); // Set received offer as remote description

    console.log("Creating Answer...");
    const answer = await peerConnection.createAnswer(); // Create SDP answer
    await peerConnection.setLocalDescription(answer); // Set answer as local description
    console.log("Answer created and local description set.");
    return peerConnection.localDescription; // Return the Answer SDP
  } catch (error) {
    console.error("Error handling offer or creating/setting answer:", error);
    updateStatus(`Offer handling / Answer creation error: ${error.message}`, 'red'); // ★ English
    currentAppState = AppState.ERROR;
    return null;
  }
}

// Handle received Answer SDP and set as remote description
async function handleAnswer(answerSdp) {
  if (!peerConnection) {
       console.error("Cannot handle answer: PeerConnection not ready.");
       return false;
  }
  console.log("Received answer, setting remote description...");
  try {
    // Set the received answer as the remote description
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
    console.log("Remote description set with answer. Connection should establish soon.");
    return true; // Success
  } catch (error) {
    console.error("Error setting remote description with answer:", error);
    updateStatus(`Answer handling error: ${error.message}`, 'red'); // ★ English
    currentAppState = AppState.ERROR;
    return false; // Failure
  }
}


// Reset the connection state and UI
function resetConnection() {
    console.log("Resetting connection state...");
    // Stop any active QR scanner
    try {
        if (typeof Html5QrcodeScannerState !== 'undefined' && window.html5QrCodeScanner && window.html5QrCodeScanner.getState() === Html5QrcodeScannerState.SCANNING) {
            window.html5QrCodeScanner.stop().catch(e => console.warn("Error stopping scanner during reset:", e));
        } else if (window.html5QrCodeScanner) {
             // Attempt to stop even if not scanning, might clear resources
             window.html5QrCodeScanner.clear().catch(e => console.warn("Error clearing scanner during reset:", e));
        }
    } catch(e) { console.warn("Error accessing scanner state during reset:", e); }

    // Close data channel and remove handlers
    if (dataChannel) {
        dataChannel.onmessage = null;
        dataChannel.onopen = null;
        dataChannel.onclose = null;
        dataChannel.onerror = null;
        dataChannel.close();
    }
    // Close peer connection and remove handlers
    if (peerConnection) {
        peerConnection.onicecandidate = null;
        peerConnection.ondatachannel = null;
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.close();
    }
    // Stop and clear local media stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        if(localVideoElement) localVideoElement.srcObject = null;
        // Reset call button UI
        if(callButton) callButton.textContent = '📞';
        if(videoButton) videoButton.textContent = '🎥'; // Reset icon
        // Buttons will be disabled by setInteractionUiEnabled(false) below
    }
    // Clear remote video
    if (remoteVideoElement) remoteVideoElement.srcObject = null;

    // Reset state variables
    peerConnection = null;
    dataChannel = null;
    selectedFriendId = null;
    currentAppState = AppState.INITIAL;
    // Reset file transfer state
    receiveBuffer = {};
    receivedSize = {};
    incomingFileInfo = {};
    if (fileTransferStatusElement) fileTransferStatusElement.textContent = '';


    // Reset UI to initial state
    updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId })); // Show initial QR
    if(qrElement) qrElement.style.display = 'block';
    if(qrReaderElement) qrReaderElement.style.display = 'none'; // Hide QR reader
    if(startScanButton) startScanButton.disabled = false; // Enable scan button
    updateStatus('Waiting for connection', 'black'); // ★ English
    setInteractionUiEnabled(false); // Disable interaction UI
    // Clear message areas
    if(messageAreaElement) messageAreaElement.innerHTML = '';
    if(postAreaElement) postAreaElement.innerHTML = '';
    // Do NOT automatically restart scanner here
}


// ==================================================
// DataChannel Communication Handling
// ==================================================
// Handle messages received via DataChannel
function handleDataChannelMessage(event) {
  // Check if data is ArrayBuffer (file chunk) or string (JSON message)
  if (event.data instanceof ArrayBuffer) {
    // --- Handle File Chunk ---
    // Assuming JSON chunk message format for now (less efficient but simpler)
    try {
        const message = JSON.parse(new TextDecoder().decode(event.data));
        if (message.type === 'file-chunk') {
             processFileChunk(message);
        } else {
             // If it wasn't a JSON chunk message, maybe it's legacy text?
             processTextMessage(new TextDecoder().decode(event.data));
        }
    } catch(e) {
        // If JSON parsing fails, assume it's a legacy text message
        processTextMessage(new TextDecoder().decode(event.data));
    }

  } else if (typeof event.data === 'string') {
    // --- Handle JSON Message ---
    processTextMessage(event.data);
  } else {
    console.warn("Received unexpected data type:", typeof event.data);
  }
}

// Process text-based (JSON) messages
async function processTextMessage(dataString) {
    try {
        const message = JSON.parse(dataString);
        console.log("Received message:", message);
        switch (message.type) {
            case 'post': // Group chat post
                await savePost(message); // Save to IndexedDB
                displayPost(message, true); // Display in UI
                break;
            case 'direct-message': // Direct message
                displayDirectMessage(message, false); // Display in UI (as received)
                break;
            case 'delete-post': // Request to delete a post
                console.log("Received delete request for post:", message.postId);
                const postElement = document.getElementById(`post-${message.postId}`);
                if (postElement) {
                    postElement.remove(); // Remove from UI
                }
                await deletePostFromDb(message.postId); // Remove from local DB
                break;
            case 'file-metadata': // Metadata for an incoming file
                incomingFileInfo[message.fileId] = {
                    name: message.name,
                    size: message.size,
                    type: message.fileType // Use fileType from metadata
                };
                receiveBuffer[message.fileId] = []; // Initialize buffer for this file
                receivedSize[message.fileId] = 0; // Initialize received size
                console.log("Receiving metadata for file:", message.name, message.size);
                if (fileTransferStatusElement) {
                    fileTransferStatusElement.textContent = `Receiving ${message.name}... 0%`;
                }
                break;
            case 'file-chunk':
                 processFileChunk(message); // Handle chunk logic
                 break;

            // Add other message types here
            default:
                console.warn("Received unknown message type:", message.type);
                // Compatibility for older format (assume post if no type)
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

// Process received file chunks (called from handleDataChannelMessage)
function processFileChunk(chunkMessage) {
    const fileId = chunkMessage.fileId;
    const chunkIndex = chunkMessage.index;
    const isLast = chunkMessage.last;

    if (!incomingFileInfo[fileId] || !receiveBuffer[fileId]) {
        console.error("Received chunk for unknown file transfer:", fileId);
        return;
    }

    // Decode base64 data (assuming JSON chunk message format)
    const byteString = atob(chunkMessage.data);
    const byteArray = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
        byteArray[i] = byteString.charCodeAt(i);
    }
    const chunk = byteArray.buffer;

    receiveBuffer[fileId][chunkIndex] = chunk; // Store chunk in order
    receivedSize[fileId] += chunk.byteLength;

    const progress = Math.round((receivedSize[fileId] / incomingFileInfo[fileId].size) * 100);
     if (fileTransferStatusElement) {
        fileTransferStatusElement.textContent = `Receiving ${incomingFileInfo[fileId].name}... ${progress}%`;
    }

    // If this is the last chunk, assemble the file
    if (isLast) {
        console.log("Received last chunk for file:", incomingFileInfo[fileId].name);
        // Ensure all chunks are received before creating Blob (simple check)
        const expectedChunks = Math.ceil(incomingFileInfo[fileId].size / CHUNK_SIZE);
        if (receiveBuffer[fileId].length < expectedChunks) {
             console.warn(`Missing chunks for file ${fileId}. Expected ${expectedChunks}, got ${receiveBuffer[fileId].length}. Cannot assemble.`);
             if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Error receiving ${incomingFileInfo[fileId].name}`;
             // Clean up partial data
             delete incomingFileInfo[fileId];
             delete receiveBuffer[fileId];
             delete receivedSize[fileId];
             return;
        }

        const fileBlob = new Blob(receiveBuffer[fileId], { type: incomingFileInfo[fileId].type });

        // Create a download link
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(fileBlob);
        downloadLink.download = incomingFileInfo[fileId].name;
        downloadLink.textContent = `Download ${incomingFileInfo[fileId].name}`;
        downloadLink.style.display = 'block'; // Make it visible
        downloadLink.style.marginTop = '5px';

        // Append link to the status area or message area
        if (fileTransferStatusElement) {
            fileTransferStatusElement.textContent = ''; // Clear status
            fileTransferStatusElement.appendChild(downloadLink);
        } else {
            messageAreaElement.appendChild(downloadLink); // Fallback location
        }

        // Clean up
        delete incomingFileInfo[fileId];
        delete receiveBuffer[fileId];
        delete receivedSize[fileId];
    }
}


// Direct Mail 送信
function handleSendMessage() {
    const input = messageInputElement; // Use global reference
    const content = input?.value?.trim();
    // Check if connected and content exists
    if (content && dataChannel && dataChannel.readyState === 'open') {
        const message = {
            type: 'direct-message',
            content: content,
            sender: myDeviceId,
            timestamp: new Date().toISOString()
        };
        try {
            dataChannel.send(JSON.stringify(message)); // Send message
            displayDirectMessage(message, true); // Display own message
            if(input) input.value = ''; // Clear input field
        } catch (error) {
            console.error("Error sending message:", error);
            alert("Failed to send message."); // ★ English
        }
    } else if (!dataChannel || dataChannel.readyState !== 'open') {
        // Provide feedback if not connected
        const stateMsg = dataChannel ? ` (State: ${dataChannel.readyState})` : '';
        console.warn(`Cannot send message. DataChannel not open${stateMsg}. Current app state: ${currentAppState}`);
        alert(`Not connected${stateMsg}. Please scan the QR code again.`); // ★ English
        if (currentAppState !== AppState.CONNECTED) {
            resetConnection(); // Reset if not properly connected
        }
    }
}

// Direct Mail 表示
function displayDirectMessage(message, isOwnMessage = false) {
    if (!messageAreaElement) return;
    const div = document.createElement('div');
    div.classList.add('message', isOwnMessage ? 'own-message' : 'peer-message');
    // Create HTML string including sender ('You' or peer ID) and content
    // ★ XSS Protection: Sanitize HTML before setting innerHTML
    const unsafeHTML = `<strong>${isOwnMessage ? 'You' : (message.sender ? message.sender.substring(0, 6) : 'Peer')}:</strong> ${message.content}`;
    div.innerHTML = DOMPurify.sanitize(unsafeHTML); // Sanitize using DOMPurify

    messageAreaElement.appendChild(div);
    // Scroll to the bottom of the message area
    messageAreaElement.scrollTop = messageAreaElement.scrollHeight;
}

// 投稿送信
async function handleSendPost() {
  const input = postInputElement; // Use global reference
  const content = input?.value?.trim();
  if (content) {
    const post = {
      type: 'post', // Mark message type as 'post'
      id: generateUUID(),
      content: content,
      sender: myDeviceId,
      timestamp: new Date().toISOString()
    };
    await savePost(post); // Save post locally to IndexedDB
    displayPost(post, true); // Display post locally
    // Send post to peer if connected
    if (dataChannel && dataChannel.readyState === 'open') {
      try {
          dataChannel.send(JSON.stringify(post));
          console.log("Post sent via DataChannel:", post.id);
      } catch (error) {
          console.error("Error sending post:", error);
          alert("Failed to send post."); // ★ English
      }
    } else {
        console.log("Post saved locally, but not sent (no open DataChannel).");
        // Notify user if not connected when posting
        if (!dataChannel || dataChannel.readyState !== 'open') {
             alert("Not connected. Post saved locally only."); // ★ English
        }
    }
    if(input) input.value = ''; // Clear input field
  }
}


// Handle file sending
function handleSendFile() {
    if (!fileInputElement || !fileInputElement.files || fileInputElement.files.length === 0) {
        alert("Please select a file."); // ★ English
        return;
    }
    if (!dataChannel || dataChannel.readyState !== 'open') {
        // Alert moved to button state check (disabled)
        console.warn("Send file clicked but not connected.");
        return;
    }

    const file = fileInputElement.files[0];
    const fileId = generateUUID(); // Unique ID for this transfer
    console.log(`Preparing to send file: ${file.name}, size: ${file.size}, ID: ${fileId}`);

    if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Sending ${file.name}... 0%`;
    sendFileButton.disabled = true; // Disable button during transfer

    // 1. Send metadata first
    const metadata = {
        type: 'file-metadata',
        fileId: fileId,
        name: file.name,
        size: file.size,
        fileType: file.type // Use fileType to avoid conflict with message type
    };
    try {
        dataChannel.send(JSON.stringify(metadata));
    } catch (error) {
        console.error("Error sending file metadata:", error);
        alert("Failed to send file metadata."); // ★ English
        if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'Metadata send failed';
        sendFileButton.disabled = false; // Re-enable button
        return;
    }


    // 2. Send file in chunks
    fileReader = new FileReader();
    let offset = 0;
    let chunkIndex = 0;

    fileReader.addEventListener('error', error => {
        console.error('FileReader error:', error);
        alert('File read error occurred.'); // ★ English
        if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'File read error';
        sendFileButton.disabled = false; // Re-enable button
    });
    fileReader.addEventListener('abort', event => {
        console.log('FileReader abort:', event);
        if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'File send aborted';
        sendFileButton.disabled = false; // Re-enable button
    });
    fileReader.addEventListener('load', e => {
        const chunk = e.target.result; // ArrayBuffer

        // Check DataChannel buffer before sending (simple backpressure)
        const bufferedAmount = dataChannel.bufferedAmount || 0;
        if (bufferedAmount > CHUNK_SIZE * 16) { // Example threshold: 16 chunks
            console.warn(`DataChannel buffer full (${bufferedAmount}), pausing send...`);
            setTimeout(() => {
                sendFileChunk(chunk, file, fileId, chunkIndex, offset);
            }, 100); // Wait 100ms
            return; // Don't proceed immediately
        }

        // Send the current chunk
        sendFileChunk(chunk, file, fileId, chunkIndex, offset);

    });

    const readSlice = o => {
        try {
            const slice = file.slice(o, o + CHUNK_SIZE);
            fileReader.readAsArrayBuffer(slice);
        } catch (readError) {
             console.error('Error reading file slice:', readError);
             alert('Failed to read file slice.'); // ★ English
             if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'File slice error';
             sendFileButton.disabled = false; // Re-enable button
        }
    };

    // Function to actually send the chunk and handle next step
    const sendFileChunk = (chunkData, originalFile, currentFileId, currentChunkIndex, currentOffset) => {
         console.log(`Sending chunk ${currentChunkIndex}, size: ${chunkData.byteLength}`);
         try {
             // --- Sending chunk data as Base64 encoded string within JSON ---
             const base64String = btoa(String.fromCharCode(...new Uint8Array(chunkData)));
             const chunkMessage = {
                 type: 'file-chunk',
                 fileId: currentFileId,
                 index: currentChunkIndex,
                 last: ((currentOffset + chunkData.byteLength) >= originalFile.size),
                 data: base64String // Send data as base64 string
             };
             dataChannel.send(JSON.stringify(chunkMessage));

             const newOffset = currentOffset + chunkData.byteLength;

             // Update progress
             const progress = Math.round((newOffset / originalFile.size) * 100);
             if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Sending ${originalFile.name}... ${progress}%`;

             if (newOffset < originalFile.size) {
                 // Schedule next readSlice using setTimeout to prevent blocking UI thread
                 setTimeout(() => readSlice(newOffset), 0);
             } else {
                 console.log(`File ${originalFile.name} sent successfully.`);
                 if (fileTransferStatusElement) fileTransferStatusElement.textContent = `Sent ${originalFile.name}`;
                 if(fileInputElement) fileInputElement.value = ''; // Clear file input
                 sendFileButton.disabled = false; // Re-enable button
             }
         } catch (error) {
             console.error(`Error sending chunk ${currentChunkIndex}:`, error);
             alert(`Failed to send chunk ${currentChunkIndex}.`); // ★ English
             if (fileTransferStatusElement) fileTransferStatusElement.textContent = 'Chunk send error';
             sendFileButton.disabled = false; // Re-enable button
             // Consider aborting the transfer here
         }
    }


    readSlice(0); // Start reading the first chunk
}


// ==================================================
// Media Handling (Video Call)
// ==================================================

// Toggle video call on/off
async function toggleVideoCall() {
    // Ensure connection is fully established before starting call
    if (!peerConnection || currentAppState !== AppState.CONNECTED) {
        console.warn("Call button clicked but not connected.");
        return;
    }
    if (!localStream) { // Start call
        console.log("Starting video call...");
        try {
            // Get user's camera and microphone
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideoElement) localVideoElement.srcObject = localStream; // Display local video
            // Add local tracks to the PeerConnection to send to the peer
            localStream.getTracks().forEach(track => {
                try {
                    if (peerConnection.addTrack) {
                        peerConnection.addTrack(track, localStream);
                    } else {
                        console.warn("peerConnection.addTrack is not supported.");
                    }
                } catch (e) { console.error("Error adding track:", e); }
            });
            // Update button UI
            if(callButton) callButton.textContent = 'End Call';
        } catch (error) {
            console.error("Error starting video call:", error);
            alert(`Media access error: ${error.message}`); // ★ English
            localStream = null; // Reset stream if failed
        }
    } else { // End call
        console.log("Ending video call...");
        localStream.getTracks().forEach(track => track.stop()); // Stop local media tracks
        localStream = null;
        // Remove tracks from the PeerConnection
        peerConnection.getSenders().forEach(sender => {
            if (sender.track) {
                try {
                    if (peerConnection.removeTrack) {
                        peerConnection.removeTrack(sender);
                    } else {
                         console.warn("peerConnection.removeTrack is not supported.");
                    }
                } catch (e) { console.error("Error removing track:", e); }
            }
        });
        if(localVideoElement) localVideoElement.srcObject = null; // Clear local video display
        // Update button UI
        if(callButton) callButton.textContent = '📞';
        if(videoButton) videoButton.textContent = '🎥'; // Reset icon
    }
}

// Toggle local video on/off during a call
function toggleLocalVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled; // Enable/disable the track
            if(videoButton) videoButton.textContent = videoTrack.enabled ? '🎥' : '🚫'; // Update button icon
            console.log(`Local video ${videoTrack.enabled ? 'enabled' : 'disabled'}`);
        }
    }
}


// ==================================================
// QR Code Handling (Display & Scan)
// ==================================================

// Update the QR code displayed on the canvas
function updateQrCodeWithValue(value) {
    if (!qrElement) {
        console.warn("QR element not available for update.");
        return;
    }
    // Adjust size based on window width, slightly smaller
    const size = Math.min(window.innerWidth * 0.7, 250);
    // Check if QRious library is loaded
    if (typeof QRious !== 'undefined') {
        try {
            // Generate QR code with lower error correction level ('L') for simplicity
            new QRious({ element: qrElement, value: value || '', size: size, level: 'L' });
            console.log("QR Code updated (Level L):", value ? value.substring(0, 50) + '...' : ''); // Log truncated value
        } catch (e) {
             console.error("QRious error:", e);
             qrElement.textContent = "QR Code Generation Error"; // ★ English
        }
    } else {
        console.error("QRious not loaded.");
        // Retry after a delay if library might still be loading
        setTimeout(() => updateQrCodeWithValue(value), 500);
    }
}

// Handle clicking the start scan button
function handleStartScanClick() {
    if (currentAppState === AppState.INITIAL) {
        startQrScanner();
    } else {
        console.warn("Scan button clicked but not in INITIAL state.");
    }
}


// Start the QR code scanner
function startQrScanner() {
    // Don't start if not in initial state
    if (currentAppState !== AppState.INITIAL) {
        console.log(`QR Scanner not starting in state: ${currentAppState}`);
        // Ensure button is disabled if not initial
        if(startScanButton) startScanButton.disabled = true;
        return;
    }
    if (!qrReaderElement) {
        console.warn("QR Reader element not available for start.");
        return;
    }

    // Disable start button and show reader
    if(startScanButton) startScanButton.disabled = true;
    qrReaderElement.style.display = 'block'; // Show reader element

    // Check if html5-qrcode library is loaded
    if (typeof Html5Qrcode !== 'undefined') {
        // Attempt to stop any existing scanner instance (robust check)
        try {
            if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.getState === 'function') {
                 const state = window.html5QrCodeScanner.getState();
                 if (state === 2 /* SCANNING */ || state === 1 /* INITIALIZED */) {
                     window.html5QrCodeScanner.stop().catch(e => console.warn("Ignoring error stopping previous scanner:", e));
                 }
            } else if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.clear === 'function') {
                // Fallback for potential different states/versions
                window.html5QrCodeScanner.clear().catch(e => console.warn("Ignoring error clearing previous scanner:", e));
            }
        } catch (e) { console.warn("Error accessing previous scanner state:", e); }

        // Create a new scanner instance
        try {
            window.html5QrCodeScanner = new Html5Qrcode("qr-reader");
        } catch (e) {
            console.error("Error creating Html5Qrcode instance:", e);
            updateStatus(`QR Reader initialization error: ${e.message}`, 'red'); // ★ English
            if(qrReaderElement) qrReaderElement.style.display = 'none';
            if(startScanButton) startScanButton.disabled = false; // Re-enable button on error
            return; // Abort if instance creation fails
        }

        // Callback for successful QR code scan
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            console.log(`QR Scan success: ${decodedText ? decodedText.substring(0, 50) + '...' : ''}`);
            if (qrResultsElement) qrResultsElement.textContent = `Scan successful`; // ★ English
            setTimeout(() => { if(qrResultsElement) qrResultsElement.textContent = ''; }, 1500); // Show success briefly

            // Stop the scanner and then handle the data
            window.html5QrCodeScanner.stop().then(ignore => {
                console.log("QR Scanner stopped after success.");
                if(qrReaderElement) qrReaderElement.style.display = 'none'; // Hide reader
                // Button remains disabled until connection reset or failure
                 handleScannedQrData(decodedText); // Process scanned data
            }).catch(err => {
                 console.error("QR Scanner stop failed after success:", err);
                 if(qrReaderElement) qrReaderElement.style.display = 'none'; // Still hide reader
                 // Button remains disabled
                 handleScannedQrData(decodedText); // Attempt to process data even if stop fails
            });
        };
        // Configuration for the scanner
        const config = { fps: 10, qrbox: { width: 200, height: 200 } }; // Smaller QR box

        console.log("Starting QR scanner...");
        // Start scanning using the back camera
        window.html5QrCodeScanner.start({ facingMode: "environment" }, config, qrCodeSuccessCallback)
            .catch(err => {
                console.error(`QR Scanner start error: ${err}`);
                // Provide user-friendly error messages
                if (err.name === 'NotAllowedError') {
                    updateStatus('Camera access denied. Please check settings.', 'red'); // ★ English
                } else {
                    updateStatus(`QR scanner error: ${err.message}`, 'red'); // ★ English
                }
                if(qrReaderElement) qrReaderElement.style.display = 'none'; // Hide reader on error
                if(startScanButton) startScanButton.disabled = false; // Re-enable button on error
            });
    } else {
        console.error("Html5Qrcode not loaded.");
        if(qrReaderElement) qrReaderElement.style.display = 'none'; // Hide reader
        if(startScanButton) startScanButton.disabled = false; // Re-enable button
        // Retry after a delay
        setTimeout(startQrScanner, 500);
    }
}

// Process the data obtained from scanning a QR code (Core signaling logic)
async function handleScannedQrData(decodedText) {
    console.log("Handling scanned data:", decodedText ? decodedText.substring(0, 50) + '...' : '');
    try {
        const data = JSON.parse(decodedText); // Parse the JSON data from QR
        console.log("Parsed data:", data);

        // Ignore if already connected
        if (currentAppState === AppState.CONNECTED) {
            console.log("Already connected. Ignoring scanned data.");
            updateStatus("Already connected.", "green"); // ★ English
            if(startScanButton) startScanButton.disabled = true; // Keep disabled if connected
            return;
        }
        // Handle scanning a new QR while already trying to connect
        if (currentAppState === AppState.CONNECTING && data.type !== 'answer' && peerConnection?.localDescription?.type === 'offer') {
            console.warn("Received non-answer QR while waiting for answer. Resetting...");
            resetConnection();
            if (data.type === 'initial') { // If the new QR is an initial one, try processing it after reset
                setTimeout(() => handleScannedQrData(decodedText), 200);
            }
            return;
        }
         if (currentAppState === AppState.CONNECTING && data.type !== 'initial' && peerConnection?.localDescription?.type === 'answer') {
             console.warn("Received non-initial QR while waiting for connection after sending answer. Ignoring.");
             // Keep scan button disabled while connecting
             if(startScanButton) startScanButton.disabled = true;
             return; // Ignore other QRs after sending answer
        }

        // --- Signaling Logic ---
        // 1. Received peer's initial info (while in initial state) -> Create Offer
        if (data.type === 'initial' && currentAppState === AppState.INITIAL) {
            selectedFriendId = data.deviceId;
            updateStatus(`Peer (${selectedFriendId.substring(0,6)}...) recognized. Creating Offer...`, 'orange'); // ★ English
            currentAppState = AppState.CONNECTING;
            if(startScanButton) startScanButton.disabled = true; // Disable scan button while connecting
            if (await createPeerConnection()) {
                const offerSdp = await createOfferAndSetLocal(); // Create Offer
                if (offerSdp) {
                    const offerData = { type: 'offer', sdp: offerSdp, senderId: myDeviceId };
                    updateQrCodeWithValue(JSON.stringify(offerData)); // Display Offer QR
                    updateStatus('Offer created. Please have your friend scan this QR code.', 'blue'); // ★ English
                } else { currentAppState = AppState.ERROR; resetConnection(); }
            } else { currentAppState = AppState.ERROR; resetConnection(); }
        }
        // 2. Received peer's Offer (while in initial state) -> Create Answer
        else if (data.type === 'offer' && currentAppState === AppState.INITIAL) {
            selectedFriendId = data.senderId;
            updateStatus(`Received Offer from peer (${selectedFriendId.substring(0,6)}...). Creating Answer...`, 'orange'); // ★ English
            currentAppState = AppState.CONNECTING;
            if(startScanButton) startScanButton.disabled = true; // Disable scan button while connecting
            if (await createPeerConnection()) {
                const answerSdp = await handleOfferAndCreateAnswer(data.sdp); // Handle Offer, Create Answer
                if (answerSdp) {
                    const answerData = { type: 'answer', sdp: answerSdp, senderId: myDeviceId };
                    updateQrCodeWithValue(JSON.stringify(answerData)); // Display Answer QR
                    updateStatus('Answer created. Please have your friend scan this QR code.', 'blue'); // ★ English
                } else { currentAppState = AppState.ERROR; resetConnection(); }
            } else { currentAppState = AppState.ERROR; resetConnection(); }
        }
        // 3. Received peer's Answer (while connecting, after sending Offer) -> Finalize
        else if (data.type === 'answer' && currentAppState === AppState.CONNECTING && peerConnection?.localDescription?.type === 'offer') {
             updateStatus('Received Answer from peer. Connecting...', 'orange'); // ★ English
             // Keep scan button disabled
             if(startScanButton) startScanButton.disabled = true;
             if (await handleAnswer(data.sdp)) { // Handle Answer
                 console.log("Answer processed. Waiting for connection state change.");
                 if(qrElement) qrElement.style.display = 'none'; // Hide own QR after receiving answer
             } else { currentAppState = AppState.ERROR; resetConnection(); }
        }
        // Handle unexpected data/state
        else {
            console.warn(`Unexpected data type ${data.type} in state ${currentAppState} with localDescription type ${peerConnection?.localDescription?.type}`);
            updateStatus(`Unexpected data (${data.type}) or state (${currentAppState}). Resetting.`, 'orange'); // ★ English
            resetConnection();
        }
    } catch (error) {
        console.error("Error handling scanned data:", error);
        if (error instanceof SyntaxError) {
             updateStatus('Invalid QR code data format.', 'red'); // ★ English
        } else {
             updateStatus(`QR data processing error: ${error.message}`, 'red'); // ★ English
        }
        currentAppState = AppState.ERROR;
        resetConnection(); // Reset on error
    }
}


// ==================================================
// Event Listener Setup
// ==================================================
function setupEventListeners() {
    // Handle window resize (redraw QR code if visible)
    window.addEventListener('resize', () => {
        if (qrElement && qrElement.style.display !== 'none') {
             if (currentAppState === AppState.INITIAL) {
                 updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
             } else if (currentAppState === AppState.CONNECTING && peerConnection?.localDescription) {
                 const sdpData = { type: peerConnection.localDescription.type, sdp: peerConnection.localDescription, senderId: myDeviceId };
                 updateQrCodeWithValue(JSON.stringify(sdpData));
             }
        }
    });

    // Button click handlers
    sendMessageButton?.addEventListener('click', handleSendMessage);
    sendPostButton?.addEventListener('click', handleSendPost);
    sendFileButton?.addEventListener('click', handleSendFile);
    callButton?.addEventListener('click', toggleVideoCall);
    videoButton?.addEventListener('click', toggleLocalVideo);
    startScanButton?.addEventListener('click', handleStartScanClick); // Scan button listener

    // Optional: Handle Enter key press in input fields
    messageInputElement?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
    });
    postInputElement?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendPost();
    });

    console.log("Event listeners set up.");
}

// ==================================================
// Initialization (on DOMContentLoaded)
// ==================================================
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM fully loaded and parsed. Initializing app...");

  // 0. Get references to UI elements
  qrElement = document.getElementById('qrcode');
  statusElement = document.getElementById('connectionStatus');
  qrReaderElement = document.getElementById('qr-reader');
  qrResultsElement = document.getElementById('qr-reader-results');
  localVideoElement = document.getElementById('localVideo');
  remoteVideoElement = document.getElementById('remoteVideo');
  messageAreaElement = document.getElementById('messageArea');
  postAreaElement = document.getElementById('postArea');
  // Chat UI elements
  messageInputElement = document.getElementById('messageInput');
  sendMessageButton = document.getElementById('sendMessage');
  postInputElement = document.getElementById('postInput');
  sendPostButton = document.getElementById('sendPost');
  // File transfer UI elements
  fileInputElement = document.getElementById('fileInput');
  sendFileButton = document.getElementById('sendFile');
  fileTransferStatusElement = document.getElementById('file-transfer-status');
  // Call control UI elements
  callButton = document.getElementById('callButton');
  videoButton = document.getElementById('videoButton');
  // Scan button
  startScanButton = document.getElementById('startScanButton');


  // Check if idb library loaded and DB opened
  if (typeof idb === 'undefined') {
      updateStatus("Database features disabled (idb library not loaded).", "orange"); // ★ English
  } else if (!dbPromise) {
      console.error("IndexedDB could not be opened.");
      updateStatus("Database initialization failed.", "red"); // ★ English
  }

  // 1. Generate unique ID for this device
  myDeviceId = generateUUID();
  console.log("My Device ID:", myDeviceId);

  // 2. Display initial posts from IndexedDB
  displayInitialPosts();

  // 3. Set up event listeners for buttons, etc.
  setupEventListeners();

  // 4. Display initial QR code and status
  updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
  updateStatus('Waiting for connection', 'black'); // ★ English
  setInteractionUiEnabled(false); // Disable interaction UI initially

  // 5. QR scanner is NOT started automatically anymore

  // 6. Register Service Worker (with scope for PWA)
  if ('serviceWorker' in navigator) {
    // Register with scope '/' to control the whole app
    navigator.serviceWorker.register('/static/cnc/service-worker.js', { scope: '/' })
      .then(registration => {
        console.log('Service Worker registered successfully with scope:', registration.scope);
        // Optional: Check for updates
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.log('New content is available; please refresh.');
                  // Optionally notify user to refresh
                  // updateStatus("New version available. Please refresh.", "blue"); // ★ English Example
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
        updateStatus(`Service Worker registration error: ${error.message}`, 'red'); // ★ English
      });
  } else {
    console.log("Service Worker not supported.");
    updateStatus('Offline features unavailable (Service Worker not supported)', 'orange'); // ★ English
  }

  console.log("App initialization complete.");
  currentAppState = AppState.INITIAL; // Set initial state explicitly

}); // End of DOMContentLoaded listener

