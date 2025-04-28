// /home/my/d/cybernetcall/cnc/static/cnc/app.js
// Practical P2P implementation using Offer/Answer SDP and ICE Candidate exchange via QR.

// ==================================================
//  Global Variables & State Management
// ==================================================
let myDeviceId; // Unique ID for this device
let peerConnection; // RTCPeerConnection instance
let dataChannel; // RTCDataChannel instance
let localStream; // Local media stream
let iceCandidatesQueue = []; // Queue for local ICE candidates before sending
let receivedIceCandidatesQueue = []; // Queue for received ICE candidates before adding
let peerId = null; // Peer's device ID

// Application states for clearer signaling flow
const AppState = {
  INITIAL: 'initial', // Waiting for initial QR scan
  CREATING_OFFER: 'creating_offer', // PeerConnection created, creating Offer
  WAITING_FOR_ANSWER: 'waiting_for_answer', // Offer QR shown, waiting for Answer QR scan
  PROCESSING_OFFER: 'processing_offer', // Scanned Offer QR, creating Answer
  WAITING_FOR_CONNECTION: 'waiting_for_connection', // Answer QR shown/scanned, waiting for connection establishment
  EXCHANGING_CANDIDATES: 'exchanging_candidates', // SDP exchanged, now exchanging ICE candidates via QR
  CONNECTED: 'connected', // Connection established
  ERROR: 'error' // An error occurred
};
let currentAppState = AppState.INITIAL;

// UI element references (obtained in DOMContentLoaded)
let qrElement, statusElement, qrReaderElement, qrResultsElement, localVideoElement, remoteVideoElement, messageAreaElement, postAreaElement, callButton, videoButton;

// IndexedDB Promise (requires idb library)
let dbPromise = typeof idb !== 'undefined' ? idb.openDB('cybernetcall-db', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('posts')) {
      db.createObjectStore('posts', { keyPath: 'id' });
    }
    // Add other stores if needed
  }
}) : null;

if (!dbPromise) {
    console.error("idb library not loaded. IndexedDB features will be unavailable.");
}

// ==================================================
//  Utility Functions
// ==================================================

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
        if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.getState === 'function' && window.html5QrCodeScanner.getState() === 2) { // 2: SCANNING
            window.html5QrCodeScanner.stop().catch(e => console.warn("Scanner stop error:", e));
            console.log("QR Scanner stopped.");
        }
    } catch (e) { console.warn("Error stopping scanner:", e); }
}

// ==================================================
//  IndexedDB Operations (No changes from previous version)
// ==================================================
async function savePost(post) { /* ... */ }
async function displayInitialPosts() { /* ... */ }
function displayPost(post, isNew = true) { /* ... */ }
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
    // Sort by timestamp if available (newest first)
    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    posts.forEach(post => displayPost(post, false)); // isNew=false
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
  // Example: Display sender ID (shortened) and content
  div.innerHTML = `<strong>${post.sender ? post.sender.substring(0, 6) : 'Unknown'}:</strong> ${post.content}`;
  if (isNew && postAreaElement.firstChild) {
      postAreaElement.insertBefore(div, postAreaElement.firstChild);
  } else {
      postAreaElement.appendChild(div);
  }
}


// ==================================================
//  WebRTC Core Functions (Offer/Answer + ICE Candidate Exchange)
// ==================================================

// Create PeerConnection and set up event handlers
async function createPeerConnection() {
  if (peerConnection) {
    console.warn("Closing existing PeerConnection.");
    peerConnection.close(); // Close existing connection first
  }
  console.log("Creating PeerConnection...");
  iceCandidatesQueue = []; // Reset candidate queue
  receivedIceCandidatesQueue = []; // Reset received queue

  try {
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Handle ICE Candidate generation
    peerConnection.onicecandidate = event => {
      if (event.candidate) {
        console.log('Generated ICE Candidate:', event.candidate);
        // Queue the candidate. Send later via QR after SDP exchange.
        iceCandidatesQueue.push(event.candidate);
        // If SDP exchange is done, immediately show QR for candidates
        if (currentAppState === AppState.EXCHANGING_CANDIDATES) {
            displayIceCandidatesQr();
        }
      } else {
        console.log("All ICE candidates gathered for this phase.");
        // If SDP exchange is done, ensure the final QR is shown
        if (currentAppState === AppState.EXCHANGING_CANDIDATES) {
            displayIceCandidatesQr(); // Show QR even if queue is empty (signals end)
        }
      }
    };

    // Handle DataChannel reception (when the peer creates it)
    peerConnection.ondatachannel = event => {
      console.log("Data channel received:", event.channel.label);
      dataChannel = event.channel;
      setupDataChannelEvents();
    };

    // Handle media track reception
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

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log("PeerConnection state:", peerConnection.connectionState);
      switch (peerConnection.connectionState) {
        case 'connected':
          if (currentAppState !== AppState.CONNECTED) {
              currentAppState = AppState.CONNECTED;
              updateStatus('Connection established!', 'green');
              showQrCode(false); // Hide QR
              showQrScanner(false); // Hide Scanner
              processReceivedIceCandidates(); // Add any queued candidates
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
              // Don't change state if already connecting or connected
              // currentAppState = AppState.CONNECTING; // State managed by signaling flow
              updateStatus('Connecting...', 'orange');
          }
          break;
        default: // 'new', 'checking'
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

// Setup DataChannel event handlers
function setupDataChannelEvents() {
    if (!dataChannel) return;
    console.log(`Setting up DataChannel event handlers for channel: ${dataChannel.label}`);
    dataChannel.onmessage = handleDataChannelMessage;
    dataChannel.onopen = () => {
        console.log(`Data channel '${dataChannel.label}' opened!`);
        if (currentAppState !== AppState.CONNECTED) {
             currentAppState = AppState.CONNECTED; // Ensure state is Connected
             updateStatus('Connected! (DataChannel Ready)', 'green');
             showQrCode(false);
             showQrScanner(false);
        }
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
        resetConnection(); // Reset on data channel error
    };
}

// Create Offer, set Local Description, return Offer SDP
async function createOfferAndSetLocal() {
  if (!peerConnection) {
      console.error("Cannot create offer: PeerConnection not ready.");
      return null;
  }
  console.log("Creating DataChannel 'cybernetcall-data'...");
  try {
    // Create data channel *before* creating offer
    dataChannel = peerConnection.createDataChannel('cybernetcall-data', { negotiated: false }); // Let SDP handle negotiation
    setupDataChannelEvents(); // Setup handlers for the locally created channel

    console.log("Creating Offer...");
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log("Offer created and local description set.");
    return peerConnection.localDescription; // Return the Offer SDP object
  } catch (error) {
    console.error("Error creating DataChannel, Offer or setting local description:", error);
    updateStatus(`Offer creation error: ${error.message}`, 'red');
    currentAppState = AppState.ERROR;
    return null;
  }
}

// Handle received Offer, create Answer, set Local Description, return Answer SDP
async function handleOfferAndCreateAnswer(offerSdp) {
  if (!peerConnection) {
       console.error("Cannot handle offer: PeerConnection not ready.");
       return null;
  }
  console.log("Received offer, setting remote description...");
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
    console.log("Remote description set with Offer. Creating Answer...");
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log("Answer created and local description set.");
    // Process any queued candidates received before remote description was set
    processReceivedIceCandidates();
    return peerConnection.localDescription; // Return the Answer SDP object
  } catch (error) {
    console.error("Error handling offer or creating/setting answer:", error);
    updateStatus(`Offer/Answer error: ${error.message}`, 'red');
    currentAppState = AppState.ERROR;
    return null;
  }
}

// Handle received Answer, set Remote Description
async function handleAnswer(answerSdp) {
  if (!peerConnection || !peerConnection.localDescription) {
       console.error("Cannot handle answer: PeerConnection or local description not ready.");
       return false;
  }
  console.log("Received answer, setting remote description...");
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
    console.log("Remote description set with Answer.");
    // Process any queued candidates received before remote description was set
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
    if (!peerConnection) {
        console.warn("PeerConnection not ready, queuing received ICE candidate.");
        receivedIceCandidatesQueue.push(candidate);
        return;
    }
    // Only add candidate if remote description is set
    if (!peerConnection.remoteDescription) {
        console.warn("Remote description not set, queuing received ICE candidate.");
        receivedIceCandidatesQueue.push(candidate);
        return;
    }
    console.log("Adding received ICE candidate:", candidate);
    try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("ICE candidate added successfully.");
    } catch (error) {
        // Ignore benign errors like adding candidate late
        if (error.message.includes("candidate cannot be added")) {
            console.warn("Ignoring error adding ICE candidate (possibly late or duplicate):", error.message);
        } else {
            console.error("Error adding received ICE candidate:", error);
            // Consider if this should be a fatal error
            // updateStatus(`Error adding ICE candidate: ${error.message}`, 'red');
            // currentAppState = AppState.ERROR;
        }
    }
}

// Process any queued received ICE candidates
function processReceivedIceCandidates() {
    console.log(`Processing ${receivedIceCandidatesQueue.length} queued ICE candidates.`);
    while (receivedIceCandidatesQueue.length > 0) {
        const candidate = receivedIceCandidatesQueue.shift();
        handleIceCandidate(candidate); // Re-run through handleIceCandidate logic
    }
}

// Display local ICE candidates in QR code
function displayIceCandidatesQr() {
    if (iceCandidatesQueue.length > 0) {
        console.log(`Displaying QR for ${iceCandidatesQueue.length} ICE candidates.`);
        const candidateData = {
            type: 'iceCandidates', // Use plural
            candidates: iceCandidatesQueue, // Send the whole queue
            senderId: myDeviceId
        };
        updateQrCodeWithValue(JSON.stringify(candidateData));
        updateStatus(`Show this QR to your peer to exchange connection details (${iceCandidatesQueue.length} candidates).`, 'blue');
        showQrCode(true);
        showQrScanner(false); // Hide scanner when showing QR
        // Clear the queue after displaying? Or allow multiple displays?
        // For simplicity, let's clear it. Peer needs to scan this QR.
        // iceCandidatesQueue = []; // Or keep them in case peer needs rescan? Let's keep them for now.
    } else {
        // Optionally show a message or hide QR if no candidates are left to send
        console.log("No more local ICE candidates to display in QR.");
        // updateStatus("All connection details sent. Waiting for peer.", 'blue');
        // showQrCode(false); // Maybe hide QR once all sent?
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
    currentAppState = AppState.INITIAL;

    // Reset UI to initial state
    updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
    showQrCode(true);
    showQrScanner(true); // Show scanner again
    updateStatus('Waiting for connection. Scan peer QR or show yours.', 'black');
}

// ==================================================
//  DataChannel Communication Handling (No changes)
// ==================================================
function handleDataChannelMessage(event) { /* ... */ }
function handleSendMessage() { /* ... */ }
function displayDirectMessage(message, isOwnMessage = false) { /* ... */ }
async function handleSendPost() { /* ... */ }
function handleSendFile() { /* ... */ }
// (Copy implementations from the previous provided code if needed)
// Handle incoming DataChannel messages
function handleDataChannelMessage(event) {
  try {
    const message = JSON.parse(event.data);
    console.log("Received message:", message);
    switch (message.type) {
        case 'post':
            savePost(message);
            displayPost(message, true);
            break;
        case 'direct-message':
            displayDirectMessage(message, false); // Display peer's message
            break;
        // Add other message types if needed
        default:
            console.warn("Received unknown message type:", message.type);
            // Legacy compatibility (if needed)
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

// Send a direct message
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
        try {
            dataChannel.send(JSON.stringify(message));
            displayDirectMessage(message, true); // Display own message
            if(input) input.value = '';
        } catch (error) {
            console.error("Error sending message:", error);
            updateStatus(`Error sending message: ${error.message}`, 'red');
        }
    } else if (!dataChannel || dataChannel.readyState !== 'open') {
        alert("Cannot send message: Not connected or data channel not open.");
        console.warn(`Cannot send message. DataChannel state: ${dataChannel?.readyState}`);
    }
}

// Display a direct message in the message area
function displayDirectMessage(message, isOwnMessage = false) {
    if (!messageAreaElement) return;
    const div = document.createElement('div');
    div.classList.add('message', isOwnMessage ? 'own-message' : 'peer-message');
    div.innerHTML = `<strong>${isOwnMessage ? 'You' : (message.sender ? message.sender.substring(0, 6) : 'Peer')}:</strong> ${message.content}`;
    messageAreaElement.appendChild(div);
    messageAreaElement.scrollTop = messageAreaElement.scrollHeight; // Auto-scroll
}

// Send a post (save locally, send via DataChannel if open)
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
    await savePost(post); // Save locally first
    displayPost(post, true); // Display locally
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
    if(input) input.value = ''; // Clear input field
  }
}

// Handle file sending (stub)
function handleSendFile() {
    alert("File sending is not implemented in this version.");
}


// ==================================================
//  Media Handling (Video Call - Requires SDP negotiation)
// ==================================================

// Toggle video call start/stop
async function toggleVideoCall() {
    if (!peerConnection || currentAppState !== AppState.CONNECTED) {
        alert("Please establish a connection first.");
        return;
    }

    if (!localStream) { // Start call
        console.log("Starting video call...");
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideoElement) localVideoElement.srcObject = localStream;

            // Add tracks to PeerConnection
            localStream.getTracks().forEach(track => {
                try {
                    // Check if track is already added
                    if (!peerConnection.getSenders().find(s => s.track === track)) {
                        peerConnection.addTrack(track, localStream);
                        console.log(`Added track ${track.kind} (${track.id}).`);
                    }
                } catch (e) {
                    console.error("Error adding track:", e);
                }
            });

            // Update UI
            if(callButton) callButton.textContent = 'End Call';
            if(videoButton) videoButton.style.display = 'inline-block';
            updateStatus("Video call started.", "green");

            // IMPORTANT: In a robust implementation, adding tracks after initial connection
            // often requires renegotiation (creating a new Offer/Answer exchange).
            // This simple example assumes tracks are added before the peer connects or
            // that the browser handles minor changes without full renegotiation.
            console.warn("Video tracks added. Renegotiation might be needed for robust connection.");

        } catch (error) {
            console.error("Error starting video call:", error);
            alert(`Media access error: ${error.message}`);
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            if(localVideoElement) localVideoElement.srcObject = null;
        }
    } else { // End call
        console.log("Ending video call...");
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;

        // Remove tracks from PeerConnection
        peerConnection.getSenders().forEach(sender => {
            if (sender.track) {
                try {
                    peerConnection.removeTrack(sender);
                    console.log(`Removed track ${sender.track.kind} (${sender.track.id}).`);
                } catch (e) { console.error("Error removing track:", e); }
            }
        });

        if(localVideoElement) localVideoElement.srcObject = null;
        // Remote video should stop automatically when peer removes track and RTCP packets are received.
        // Update UI
        if(callButton) callButton.textContent = '📞 Call';
        if(videoButton) {
            videoButton.style.display = 'none';
            videoButton.textContent = '🎥 Video On';
        }
        updateStatus("Video call ended.", "black");
        // Renegotiation might also be needed here in some scenarios.
    }
}

// Toggle local video stream on/off (mute/unmute)
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
//  QR Code Handling (Display & Scan)
// ==================================================

// Update QR code element with a specific string value
function updateQrCodeWithValue(value) {
    if (!qrElement) {
        console.warn("QR element not found in DOM.");
        return;
    }
    const size = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.4, 300);
    if (typeof QRious !== 'undefined') {
        try {
            // Use 'L' level for potentially large SDP/Candidate data, accept lower robustness
            new QRious({ element: qrElement, value: value || '', size: size, level: 'L' });
            let logValue = "empty";
            if (value) {
                try {
                    const parsed = JSON.parse(value);
                    logValue = `type: ${parsed.type}, data size: ${value.length}`;
                } catch { logValue = `raw size: ${value.length}`; }
            }
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
    if (currentAppState === AppState.CONNECTED) {
        console.log("Not starting scanner, already connected.");
        showQrScanner(false);
        return;
    }
    if (!qrReaderElement) {
        console.warn("QR Reader element (#qr-reader) not found.");
        return;
    }
    // Avoid restarting if already scanning
    try {
        if (window.html5QrCodeScanner && typeof window.html5QrCodeScanner.getState === 'function' && window.html5QrCodeScanner.getState() === 2) { // 2: SCANNING
            console.log("QR Scanner already running.");
            qrReaderElement.style.display = 'block'; // Ensure visible
            return;
        }
    } catch(e) { /* ignore */ }

    if (typeof Html5Qrcode !== 'undefined') {
        stopQrScanner(); // Stop any previous instance first

        window.html5QrCodeScanner = new Html5Qrcode("qr-reader");
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            console.log(`QR Scan successful: ${decodedText.substring(0, 100)}...`);
            if (qrResultsElement) {
                qrResultsElement.textContent = `Scan successful! Processing...`;
                qrResultsElement.style.display = 'block';
                setTimeout(() => { if(qrResultsElement) qrResultsElement.style.display = 'none'; }, 2000);
            }
            // Don't stop scanner immediately, allow multiple scans if needed for ICE
            // stopQrScanner(); // Stop scanner only when connection established or explicitly hidden

            handleScannedQrData(decodedText); // Process the data
        };

        const config = {
            fps: 5, // Lower FPS slightly
            qrbox: (viewfinderWidth, viewfinderHeight) => {
                let minEdgePercentage = 0.7;
                let minEdgeSize = Math.min(viewfinderWidth, viewfinderHeight);
                let qrboxSize = Math.floor(minEdgeSize * minEdgePercentage);
                return { width: qrboxSize, height: qrboxSize };
            },
            rememberLastUsedCamera: true,
        };

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
    console.log("Handling scanned data:", decodedText.substring(0,100) + "...");
    try {
        const data = JSON.parse(decodedText);
        console.log("Parsed data type:", data.type);

        // Ignore if already connected
        if (currentAppState === AppState.CONNECTED) {
            console.log("Already connected. Ignoring scanned data.");
            return;
        }

        // --- State-based Handling ---

        // Case 1: We are INITIAL, scanned peer's INITIAL QR -> Create Offer
        if (data.type === 'initial' && currentAppState === AppState.INITIAL) {
            peerId = data.deviceId;
            updateStatus(`Peer recognized (${peerId.substring(0,6)}...). Creating Offer...`, 'orange');
            currentAppState = AppState.CREATING_OFFER;
            showQrScanner(false); // Hide scanner while creating offer
            if (await createPeerConnection()) {
                const offerSdp = await createOfferAndSetLocal();
                if (offerSdp) {
                    const offerData = { type: 'offer', sdp: offerSdp, senderId: myDeviceId };
                    updateQrCodeWithValue(JSON.stringify(offerData));
                    updateStatus('Offer created. Show this QR to your peer.', 'blue');
                    showQrCode(true);
                    currentAppState = AppState.WAITING_FOR_ANSWER;
                    // Scanner remains hidden, waiting for peer to scan our Offer QR
                } else { resetConnection(); } // Offer creation failed
            } else { resetConnection(); } // PeerConnection creation failed
        }
        // Case 2: We are INITIAL, scanned peer's OFFER QR -> Create Answer
        else if (data.type === 'offer' && currentAppState === AppState.INITIAL) {
            peerId = data.senderId;
            updateStatus(`Received Offer from ${peerId.substring(0,6)}. Creating Answer...`, 'orange');
            currentAppState = AppState.PROCESSING_OFFER;
            showQrScanner(false); // Hide scanner
            if (await createPeerConnection()) {
                const answerSdp = await handleOfferAndCreateAnswer(data.sdp);
                if (answerSdp) {
                    const answerData = { type: 'answer', sdp: answerSdp, senderId: myDeviceId };
                    updateQrCodeWithValue(JSON.stringify(answerData));
                    updateStatus('Answer created. Show this QR to your peer.', 'blue');
                    showQrCode(true);
                    currentAppState = AppState.WAITING_FOR_CONNECTION; // Waiting for connection or ICE QRs
                    // Start exchanging ICE candidates phase
                    startIceCandidateExchangePhase();
                } else { resetConnection(); } // Answer creation failed
            } else { resetConnection(); } // PeerConnection creation failed
        }
        // Case 3: We are WAITING_FOR_ANSWER, scanned peer's ANSWER QR -> Process Answer
        else if (data.type === 'answer' && currentAppState === AppState.WAITING_FOR_ANSWER) {
            updateStatus(`Received Answer from ${data.senderId.substring(0,6)}. Processing...`, 'orange');
            showQrCode(false); // Hide Answer QR
            if (await handleAnswer(data.sdp)) {
                updateStatus('Answer processed. Waiting for connection...', 'blue');
                currentAppState = AppState.WAITING_FOR_CONNECTION;
                // Start exchanging ICE candidates phase
                startIceCandidateExchangePhase();
            } else { resetConnection(); } // Answer processing failed
        }
        // Case 4: We are in EXCHANGING_CANDIDATES state, scanned peer's ICE CANDIDATES QR
        else if (data.type === 'iceCandidates' && currentAppState === AppState.EXCHANGING_CANDIDATES) {
            updateStatus(`Received ${data.candidates.length} ICE candidate(s) from ${data.senderId.substring(0,6)}. Adding...`, 'orange');
            // Add received candidates
            for (const candidate of data.candidates) {
                await handleIceCandidate(candidate);
            }
            // Keep scanner open to receive more candidates if needed
            showQrScanner(true);
            // Optionally hide our own QR if we have nothing more to send?
            if (iceCandidatesQueue.length === 0) {
                 // updateStatus("All local candidates sent. Waiting for peer candidates or connection.", "blue");
                 // showQrCode(false);
            }
        }
        // Handle unexpected scans
        else {
            console.warn(`Unexpected data type '${data.type}' received in state '${currentAppState}'`);
            updateStatus(`Unexpected scan (${data.type} in state ${currentAppState}). Please follow the steps.`, 'orange');
            // Maybe show the correct QR or scanner based on state?
            if (currentAppState === AppState.INITIAL) showQrScanner(true);
            // etc.
        }

    } catch (error) {
        console.error("Error handling scanned data:", error);
        // Check if it's JSON parsing error vs other errors
        if (error instanceof SyntaxError) {
            updateStatus(`QR Scan Error: Invalid data format. Please scan the correct QR code.`, 'red');
        } else {
            updateStatus(`QR data processing error: ${error.message}`, 'red');
        }
        // Don't reset immediately, allow user to try again
        // resetConnection();
    }
}

// Transition to ICE candidate exchange phase
function startIceCandidateExchangePhase() {
    console.log("Transitioning to ICE candidate exchange phase.");
    currentAppState = AppState.EXCHANGING_CANDIDATES;
    updateStatus("Connection details (SDP) exchanged. Now exchanging network candidates...", "blue");
    // Display any already gathered local ICE candidates
    displayIceCandidatesQr(); // Show our candidate QR
    // Show scanner to receive peer's candidates
    showQrScanner(true);
}


// ==================================================
//  Event Listener Setup
// ==================================================
function setupEventListeners() {
    // Resize event (redraw QR code if visible)
    window.addEventListener('resize', () => {
        if (qrElement && qrElement.style.display !== 'none' && peerConnection?.localDescription) {
            // Determine current QR content based on state and redraw
            let qrValue = null;
            if (currentAppState === AppState.WAITING_FOR_ANSWER) { // Showing Offer
                qrValue = JSON.stringify({ type: 'offer', sdp: peerConnection.localDescription, senderId: myDeviceId });
            } else if (currentAppState === AppState.WAITING_FOR_CONNECTION && peerConnection.localDescription.type === 'answer') { // Showing Answer
                 qrValue = JSON.stringify({ type: 'answer', sdp: peerConnection.localDescription, senderId: myDeviceId });
            } else if (currentAppState === AppState.EXCHANGING_CANDIDATES && iceCandidatesQueue.length > 0) { // Showing Candidates
                 qrValue = JSON.stringify({ type: 'iceCandidates', candidates: iceCandidatesQueue, senderId: myDeviceId });
            } else if (currentAppState === AppState.INITIAL) { // Showing Initial
                 qrValue = JSON.stringify({ type: 'initial', deviceId: myDeviceId });
            }
            if (qrValue) {
                updateQrCodeWithValue(qrValue);
            }
        } else if (currentAppState === AppState.INITIAL && qrElement && qrElement.style.display !== 'none') {
             updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
        }
    });

    // Button events
    document.getElementById('sendMessage')?.addEventListener('click', handleSendMessage);
    document.getElementById('sendPost')?.addEventListener('click', handleSendPost);
    document.getElementById('sendFile')?.addEventListener('click', handleSendFile);
    callButton?.addEventListener('click', toggleVideoCall);
    videoButton?.addEventListener('click', toggleLocalVideo);

    // Input field Enter key listeners
    document.getElementById('messageInput')?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); handleSendMessage();
        }
    });
    document.getElementById('postInput')?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault(); handleSendPost();
        }
    });

    console.log("Event listeners set up.");
}

// ==================================================
//  Initialization (on DOMContentLoaded)
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
  callButton = document.getElementById('callButton');
  videoButton = document.getElementById('videoButton');

  // Check idb library loading status
  if (typeof idb === 'undefined') {
      updateStatus("Warning: Database features disabled (idb library not loaded)", "orange");
  }

  // 1. Generate own device ID
  myDeviceId = generateUUID();
  console.log("My Device ID:", myDeviceId);

  // 2. Display locally stored posts
  displayInitialPosts();

  // 3. Setup event listeners
  setupEventListeners();

  // 4. Display initial QR code and status
  updateQrCodeWithValue(JSON.stringify({ type: 'initial', deviceId: myDeviceId }));
  updateStatus('Waiting for connection. Scan peer QR or show yours.', 'black');
  showQrCode(true);

  // 5. Start QR scanner
  showQrScanner(true); // Start scanner initially

  // 6. Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/cnc/service-worker.js') // Ensure this path is correct
      .then(registration => {
        console.log('Service Worker registered successfully with scope:', registration.scope);
        registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.log('New content is available; please refresh.');
                  updateStatus("New version available. Please refresh.", "blue");
                } else {
                  console.log('Content is cached for offline use.');
                  updateStatus("App ready for offline use.", "green");
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
  currentAppState = AppState.INITIAL;

}); // End of DOMContentLoaded listener
