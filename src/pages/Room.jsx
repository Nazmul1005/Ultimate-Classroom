/**
 * Room.jsx
 *
 * This is the primary component for the video conferencing room. It handles:
 * - Real-time communication via Socket.io (signaling) and PeerJS (WebRTC data/media).
 * - Local media (camera, microphone) management.
 * - Screen sharing logic, including stream replacement.
 * - Participant state management (joining, leaving, media status).
 * - A dynamic layout system (main display, sidebar, modal) with participant featuring.
 * - A real-time chat with file upload capabilities.
 * - A collaborative whiteboard with drawing, text, and host controls.
 * - An AI-powered attentiveness tracking feature using MediaPipe FaceLandmarker.
 * - Host-specific controls (mute all, individual media control, start/stop attentiveness).
 * - All UI rendering, animations, and modal/drawer state.
 */

// --- React and Library Imports ---
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  // Media
  IoMicOutline, IoMicOffOutline,
  IoVideocamOutline, IoVideocamOffOutline,
  // Controls
  IoDesktopOutline, IoPowerOutline,
  IoPeopleOutline, IoStar, IoCopyOutline,
  // Chat
  IoChatbubbleOutline, IoSend, IoDocumentOutline, IoImagesOutline,
  // Whiteboard
  IoPencil, IoBrushOutline, IoText, IoColorPalette,
  IoArrowUndo, IoTrash,
  // UI
  IoSparkles, IoClose
} from 'react-icons/io5';
import Peer from 'peerjs';
import { io } from 'socket.io-client';
import { FaceLandmarker, FilesetResolver} from '@mediapipe/tasks-vision';

// --- Helper Component: ParticipantVideoTile ---
/**
 * A reusable component to render a single participant's video feed in the sidebar.
 */
const ParticipantVideoTile = ({ userId, meta, isMe, isFeatured, onFeature }) => {
  const videoRef = useRef(null);

  // Effect to attach the remote stream to the video element
  useEffect(() => {
    if (videoRef.current && meta.stream) {
      videoRef.current.srcObject = meta.stream;
      // Mute my own tile to prevent feedback
      videoRef.current.muted = isMe;
      videoRef.current.play().catch(() => {});
    }
  }, [meta.stream, isMe]);

  return (
    <div
      className="h-40 md:h-48 rounded-lg overflow-hidden shadow-lg border border-white/10 bg-black/20 flex-shrink-0"
    >
      <div className="relative w-full h-full">
        {/* Video Element */}
        <video
          key={`${userId}-video`}
          autoPlay
          playsInline
          ref={videoRef}
          className="w-full h-full object-cover"
        />
        
        {/* Camera Off Overlay */}
        {!meta.camOn && (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-900/60 to-black/60 flex items-center justify-center">
            <IoVideocamOffOutline className="w-8 h-8 text-gray-400" />
          </div>
        )}

        {/* Participant Info Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-1.5">
          <div className="flex items-center justify-between">
            <span className="text-white font-medium text-xs truncate">
              {isMe ? `${meta.userName} (You)` : meta.userName}
              {meta.isHost && ' (Host)'}
            </span>
            {/* Media Status Icons */}
            <div className="flex items-center space-x-0.5">
              {!meta.micOn && <IoMicOffOutline className="w-2.5 h-2.5 text-red-400" />}
              {!meta.camOn && <IoVideocamOffOutline className="w-2.5 h-2.5 text-red-400" />}
            </div>
          </div>
        </div>

        {/* Feature Button (for non-local participants) */}
        {!isMe && (
          <motion.button
            onClick={onFeature}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="absolute top-1 right-1 bg-black/50 hover:bg-blue-600/80 rounded-full p-1 transition-colors"
          >
            <IoStar className={`w-2.5 h-2.5 ${isFeatured ? 'text-yellow-400' : 'text-white'}`} />
          </motion.button>
        )}
      </div>
    </div>
  );
};

// --- Main Room Component ---
function Room() {
  // --- Core Hooks ---
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);

  // --- Core State ---
  const [name, setName] = useState(searchParams.get('name') || '');
  const [isHost, setIsHost] = useState(searchParams.get('isHost') !== 'false');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  
  /**
   * Main participant state.
   * A Map where:
   * Key: `userId` (PeerJS ID)
   * Value: { userId, stream, userName, isHost, micOn, camOn, attentiveness }
   */
  const [participants, setParticipants] = useState(new Map());

  // --- Attentiveness State ---
  const [isCheckingAttentiveness, setIsCheckingAttentiveness] = useState(false); // Host: Controls the check
  const [monitoringActive, setMonitoringActive] = useState(false); // Participant: Controls if model is running

  // --- UI State ---
  const [isCopied, setIsCopied] = useState(false); // For "Copy Room ID" button
  const [drawerOpen, setDrawerOpen] = useState(false); // Participant list drawer
  const [featuredId, setFeaturedId] = useState(null); // ID of the featured participant
  const [showMoreParticipants, setShowMoreParticipants] = useState(false); // Video grid modal

  // --- Chat State ---
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [fileUploading, setFileUploading] = useState(false);

  const [hostAssistantOpen, setHostAssistantOpen] = useState(false);
  const [hostAssistantMessages, setHostAssistantMessages] = useState([]);
  const [hostAssistantInput, setHostAssistantInput] = useState('');
  const [hostAssistantLoading, setHostAssistantLoading] = useState(false);
  const [hostAssistantError, setHostAssistantError] = useState('');

  // --- Whiteboard State ---
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [whiteboardTool, setWhiteboardTool] = useState('pen');
  const [whiteboardColor, setWhiteboardColor] = useState('#000000');
  const [whiteboardWidth, setWhiteboardWidth] = useState(2);
  const [isDrawing, setIsDrawing] = useState(false);
  const [whiteboardElements, setWhiteboardElements] = useState([]); // All drawing/text elements
  const [isTextMode, setIsTextMode] = useState(false);
  const [textPosition, setTextPosition] = useState(null);
  const [isPlacingText, setIsPlacingText] = useState(false);
  const [whiteboardText, setWhiteboardText] = useState('');

  // --- Main Display Logic State ---
  // This group of state determines what is shown in the large, main video player
  const [hostStream, setHostStream] = useState(null); // The host's stream
  const [activeLocalStream, setActiveLocalStream] = useState(null); // My stream (camera OR screen)
  const [activeScreenSharer, setActiveScreenSharer] = useState(null); // { userId, userName }
  const [mainDisplayStream, setMainDisplayStream] = useState(null); // The final stream for the main display

  // --- Refs ---
  
  // Core connection refs
  const socketRef = useRef(null); // Socket.io instance
  const peerRef = useRef(null);   // My PeerJS instance
  const peersRef = useRef(new Map()); // Map of active PeerJS calls (Key: userId, Value: call)

  // Media stream refs
  const localStreamRef = useRef(null);      // My persistent CAMERA stream
  const screenStreamRef = useRef(null);     // My persistent SCREEN SHARE stream
  const activeLocalStreamRef = useRef(null); // Ref to track the *currently active* local stream (camera or screen)
  
  // Main display refs
  const hostIdRef = useRef(null);     // The host's PeerJS ID
  const hostStreamRef = useRef(null); // Ref to the host's stream
  const hostVideoRef = useRef(null);  // Ref to the <video> element for the main display

  // Local media refs
  const localVideoRef = useRef(null); // Ref to the *hidden* <video> element for my camera
  const videoConstraints = useRef({ width: 480, height: 270, facingMode: 'user' });

  // Participant metadata refs
  // These refs help manage metadata before a stream is fully established
  const profiles = useRef({}); // Stores { userName, isHost, micOn, camOn }
  const profilesOrderRef = useRef([]); // Stores order of user connection

  // Attentiveness refs
  const faceLandmarkerRef = useRef(null); // MediaPipe model instance
  const attentivenessStatusRef = useRef('high'); // My last known status ('high' or 'low')
  const awayTimerRef = useRef(null); // Timer for tracking "away" time
  const inattentiveStartTimeRef = useRef(null);

  // UI/Canvas refs
  const chatEndRef = useRef(null);    // For auto-scrolling chat
  const hostAssistantEndRef = useRef(null);
  const canvasRef = useRef(null);     // Whiteboard <canvas>
  const contextRef = useRef(null);    // Whiteboard 2D context
  const lastPositionRef = useRef(null); // Last drawing position

  // --- Effects ---

  /**
   * Cosmetic effect for the animated gradient background.
   */
  useEffect(() => {
    const updateBackground = () => {
      const colors = [
        'rgba(59, 130, 246, 0.1)', 'rgba(168, 85, 247, 0.1)',
        'rgba(236, 72, 153, 0.1)', 'rgba(34, 197, 94, 0.1)'
      ];
      document.body.style.background = `
        radial-gradient(at 40% 20%, ${colors[0]} 0px, transparent 50%),
        radial-gradient(at 80% 0%, ${colors[1]} 0px, transparent 50%),
        radial-gradient(at 0% 50%, ${colors[2]} 0px, transparent 50%),
        radial-gradient(at 80% 50%, ${colors[3]} 0px, transparent 50%),
        radial-gradient(at 0% 100%, ${colors[0]} 0px, transparent 50%),
        radial-gradient(at 80% 100%, ${colors[1]} 0px, transparent 50%),
        #0f172a
      `;
    };
    updateBackground();
  }, []);

  /**
   * Initializes the whiteboard canvas when it is opened.
   * Sets up context, handles resizing, and redraws elements.
   */
  useEffect(() => {
    if (whiteboardOpen && canvasRef.current) {
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = whiteboardColor;
      context.lineWidth = whiteboardWidth;
      contextRef.current = context;
      
      const resizeCanvas = () => {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        // Redraw all elements on resize
        if (whiteboardElements.length > 0) {
          redrawCanvas(whiteboardElements);
        }
      };
      
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas);

      // Request the current whiteboard state from the server
      if (socketRef.current) {
        socketRef.current.emit('get-whiteboard-state', { roomId });
      }

      return () => window.removeEventListener('resize', resizeCanvas);
    }
  }, [whiteboardOpen, whiteboardColor, whiteboardWidth, whiteboardElements, roomId]); // Reruns if state changes

  /**
   * ----------------------------------------
   * --- CORE DISPLAY LOGIC -----------------
   * ----------------------------------------
   * This effect determines which stream to show in the main display.
   * It follows a clear priority:
   * 1. Active Screen Sharer
   * 2. Featured Participant
   * 3. Host
   */
  useEffect(() => {
    const myPeerId = peerRef.current?.id;
    
    // Priority 1: Screen Share
    if (activeScreenSharer) {
      const sharerId = activeScreenSharer.userId;
      if (sharerId === myPeerId) {
        setMainDisplayStream(activeLocalStream); // My own screen share
      } else {
        const sharer = participants.get(sharerId);
        setMainDisplayStream(sharer?.stream || null);
      }
      return; 
    }

    // Priority 2: Featured Participant
    if (featuredId) {
      if (featuredId === myPeerId || featuredId === '__me__') {
        setMainDisplayStream(activeLocalStream); // My own featured stream
      } else {
        const featured = participants.get(featuredId);
        setMainDisplayStream(featured?.stream || null);
      }
      return; 
    }
    
    // Priority 3: Host
    setMainDisplayStream(hostStream);

  }, [activeScreenSharer, featuredId, hostStream, participants, activeLocalStream]);

  /**
   * Attaches the derived `mainDisplayStream` to the main <video> element.
   * Also handles muting the main display if it's my own stream.
   */
  useEffect(() => {
    if (hostVideoRef.current) {
      hostVideoRef.current.srcObject = mainDisplayStream;
      hostVideoRef.current.play().catch(() => {});
      
      const myPeerId = peerRef.current?.id;
      // Determine if the main display is showing my own stream
      const isMyStream = 
        (activeScreenSharer && activeScreenSharer.userId === myPeerId) ||
        (featuredId === myPeerId) ||
        (isHost && !activeScreenSharer && !featuredId);
        
      hostVideoRef.current.muted = isMyStream;
    }
  }, [mainDisplayStream, activeScreenSharer, featuredId, isHost]);

  useEffect(() => {
    if (!hostAssistantOpen) return;
    if (hostAssistantEndRef.current) {
      hostAssistantEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [hostAssistantMessages, hostAssistantOpen]);

  // --- Whiteboard Functions ---

  /**
   * Adds a text element to the whiteboard (Host only).
   */
  const addTextToWhiteboard = () => {
    if (!whiteboardText.trim() || !textPosition || !isHost) return;
    
    const textElement = {
      type: 'text',
      text: whiteboardText,
      x: textPosition.x,
      y: textPosition.y,
      color: whiteboardColor,
      fontSize: Math.max(16, whiteboardWidth * 4), // Scale font with pen width
      timestamp: Date.now(),
      userId: peerRef.current?.id
    };
    
    setWhiteboardElements(prev => [...prev, textElement]);
    socketRef.current?.emit('whiteboard-draw', textElement); // Send to others
    
    if (contextRef.current) {
      drawTextOnCanvas(textElement); // Draw locally
    }
    
    // Reset text tool state
    setWhiteboardText('');
    setTextPosition(null);
  };

  /**
   * Helper function to draw a text element onto the canvas.
   */
  const drawTextOnCanvas = (textElement) => {
    if (!contextRef.current || textElement.type !== 'text') return;
    
    const context = contextRef.current;
    // Save context state
    const savedFillStyle = context.fillStyle;
    const savedFont = context.font;
    const savedTextAlign = context.textAlign;
    const savedTextBaseline = context.textBaseline;
    
    context.fillStyle = textElement.color || '#000000';
    context.font = `bold ${textElement.fontSize}px Arial`;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillText(textElement.text, textElement.x, textElement.y);
    
    // Restore context state
    context.fillStyle = savedFillStyle;
    context.font = savedFont;
    context.textAlign = savedTextAlign;
    context.textBaseline = savedTextBaseline;
  };

  /**
   * Cancels the text placement action.
   */
  const cancelTextPlacement = () => {
    setWhiteboardText('');
    setTextPosition(null);
    setIsPlacingText(false);
    setIsTextMode(false);
    setWhiteboardTool('pen'); // Revert to pen
  };

  // --- Chat Functions ---

  /**
   * Handles file selection for chat. Reads the file as a
   * data URL and sends it via Socket.io.
   */
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      alert('File size too large. Maximum 5MB allowed.');
      return;
    }

    setFileUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileData = {
          id: `file-${Date.now()}`,
          userId: peerRef.current?.id,
          userName: name,
          type: 'file',
          file: {
            name: file.name,
            type: file.type,
            size: file.size,
            data: event.target.result // The file data as a Base64 string
          },
          timestamp: Date.now()
        };

        socketRef.current.emit('chat-message', fileData);
        setChatMessages(prev => [...prev, fileData]); // Add to local messages
        setFileUploading(false);
        e.target.value = ''; // Reset file input
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('File upload error:', error);
      alert('Error uploading file. Please try again.');
      setFileUploading(false);
    }
  };

  /**
   * Regex to find URLs in text and wrap them in <a> tags.
   */
  const detectLinks = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline">${url}</a>`;
    });
  };

  /**
   * Renders the content of a chat message, handling
   * plain text (with link detection) and file types.
   */
  const renderMessageContent = (msg) => {
    // Render file messages
    if (msg.type === 'file') {
      return (
        <div className="flex items-center space-x-3 p-2 bg-white/5 rounded-lg">
          <div className="flex-shrink-0">
            {/* Show different icons for images vs. other files */}
            {msg.file.type.startsWith('image/') ? (
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <IoImagesOutline className="w-6 h-6 text-white" />
              </div>
            ) : (
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                <IoDocumentOutline className="w-6 h-6 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{msg.file.name}</p>
            <p className="text-xs text-gray-400">
              {(msg.file.size / 1024).toFixed(1)} KB • {msg.file.type}
            </p>
            <motion.a
              href={msg.file.data} // The data URL
              download={msg.file.name}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-block mt-1 px-3 py-1 bg-gradient-to-r from-green-500 to-emerald-500 rounded text-xs font-medium text-white hover:shadow-lg transition-shadow"
            >
              Download
            </motion.a>
          </div>
        </div>
      );
    }

    // Render plain text messages
    if (msg.type === 'user' || !msg.type) {
      const htmlContent = detectLinks(msg.message);
      return (
        <p 
          className="text-white break-words"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />
      );
    }

    // Fallback for other message types (e.g., system)
    return <p className="text-white break-words">{msg.message}</p>;
  };

  // --- Whiteboard Drawing Handlers ---

  /**
   * `onMouseDown` handler for the canvas (Host only).
   * Starts drawing or sets text placement position.
   */
  const startDrawing = (e) => {
    if (!whiteboardOpen || !canvasRef.current || !isHost) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // If in text mode, set the position
    if (isTextMode) {
      setIsPlacingText(true);
      setTextPosition({ x, y });
      return;
    }
    
    // If in drawing mode, start drawing path
    setIsDrawing(true);
    lastPositionRef.current = { x, y };
    
    if (whiteboardTool === 'pen' || whiteboardTool === 'eraser') {
      contextRef.current.beginPath();
      contextRef.current.moveTo(x, y);
      
      const drawingData = {
        type: 'drawing',
        tool: whiteboardTool,
        color: whiteboardTool === 'eraser' ? '#ffffff' : whiteboardColor, // Eraser is just white pen
        width: whiteboardTool === 'eraser' ? 20 : whiteboardWidth,
        points: [{ x, y }], // Start of a new line segment
        timestamp: Date.now(),
        userId: peerRef.current?.id
      };
      
      socketRef.current?.emit('whiteboard-draw', drawingData);
    }
  };

  /**
   * `onMouseMove` handler for the canvas (Host only).
   * Draws lines or updates text placement position.
   */
  const draw = (e) => {
    if (!isHost) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Update text position while dragging
    if (isPlacingText) {
      setTextPosition({ x, y });
      return;
    }
    
    if (!isDrawing || !lastPositionRef.current) return;
    
    // Continue drawing path
    if (whiteboardTool === 'pen' || whiteboardTool === 'eraser') {
      contextRef.current.lineTo(x, y);
      contextRef.current.stroke();
      
      const drawingData = {
        type: 'drawing',
        tool: whiteboardTool,
        color: whiteboardTool === 'eraser' ? '#ffffff' : whiteboardColor,
        width: whiteboardTool === 'eraser' ? 20 : whiteboardWidth,
        points: [lastPositionRef.current, { x, y }], // A single line segment
        timestamp: Date.now(),
        userId: peerRef.current?.id
      };
      
      setWhiteboardElements(prev => [...prev, drawingData]); // Add segment to history
      socketRef.current?.emit('whiteboard-draw', drawingData);
    }
    
    lastPositionRef.current = { x, y }; // Update last position
  };

  /**
   * `onMouseUp` handler for the canvas (Host only).
   * Stops drawing or finalizes text placement.
   */
  const stopDrawing = () => {
    // If placing text, mouse up confirms the location
    if (isPlacingText) {
      setIsPlacingText(false);
      return;
    }
    
    // If drawing, close the path
    if (isDrawing) {
      setIsDrawing(false);
      if (contextRef.current) {
        contextRef.current.closePath();
      }
    }
  };

  /**
   * Helper function to draw a single element (line or text) on the canvas.
   * Used for redrawing and for handling incoming socket events.
   */
  const drawOnCanvas = (element) => {
    if (!contextRef.current || !element) return;
    
    const context = contextRef.current;
    
    if (element.type === 'text') {
      drawTextOnCanvas(element);
    } else {
      // Save context state
      const savedStyle = context.strokeStyle;
      const savedWidth = context.lineWidth;
      
      context.strokeStyle = element.color || '#000000';
      context.lineWidth = element.width || 2;
      
      // Draw the line segment
      if (element.points && element.points.length >= 2) {
        context.beginPath();
        context.moveTo(element.points[0].x, element.points[0].y);
        
        for (let i = 1; i < element.points.length; i++) {
          context.lineTo(element.points[i].x, element.points[i].y);
        }
        context.stroke();
      }
      
      // Restore context state
      context.strokeStyle = savedStyle;
      context.lineWidth = savedWidth;
    }
  };

  /**
   * Clears the canvas and redraws all elements from the `whiteboardElements` state.
   * Essential for resize events or re-joining.
   */
  const redrawCanvas = (elements) => {
    if (!contextRef.current || !elements || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const context = contextRef.current;
    
    // Clear entire canvas
    context.clearRect(0, 0, canvas.width, canvas.height);
    
    // Redraw every element in order
    elements.forEach(element => {
      if (element && element.type === 'text') {
        drawTextOnCanvas(element);
      } else if (element && element.points) {
        drawOnCanvas(element);
      }
    });
  };

  /**
   * Clears the whiteboard completely (Host only).
   */
  const clearWhiteboard = () => {
    if (contextRef.current && canvasRef.current && isHost) {
      const canvas = canvasRef.current;
      contextRef.current.clearRect(0, 0, canvas.width, canvas.height);
      setWhiteboardElements([]);
      socketRef.current?.emit('whiteboard-clear'); // Tell others
    }
  };

  /**
   * Undoes the last whiteboard action (Host only).
   * This is a simplified implementation that removes the last element.
   * A more robust undo would group elements by "stroke".
   */
  const undoWhiteboard = () => {
    if (isHost) {
      socketRef.current?.emit('whiteboard-undo'); // Tell others
      
      // Remove last element and redraw
      setWhiteboardElements((prev) => {
        if (prev.length === 0) return prev;
        const newElements = prev.slice(0, -1);
        if (contextRef.current && canvasRef.current) {
          redrawCanvas(newElements);
        }
        return newElements;
      });
    }
  };

  // --- Whiteboard Tool Changers (Host only) ---

  const changeWhiteboardTool = (tool) => {
    if (!isHost) return;
    
    if (tool === 'text') {
      setIsTextMode(true);
      setWhiteboardTool('text');
      setWhiteboardText('');
      setTextPosition(null);
    } else {
      setIsTextMode(false);
      setWhiteboardTool(tool);
      setWhiteboardText('');
      setTextPosition(null);
    }
    
    socketRef.current?.emit('whiteboard-tool-change', { tool });
  };

  const changeWhiteboardColor = (color) => {
    if (!isHost) return;
    setWhiteboardColor(color);
    if (contextRef.current) {
      contextRef.current.strokeStyle = color;
    }
    socketRef.current?.emit('whiteboard-tool-change', { color });
  };

  const changeWhiteboardWidth = (width) => {
    if (!isHost) return;
    setWhiteboardWidth(width);
    if (contextRef.current) {
      contextRef.current.lineWidth = width;
    }
    socketRef.current?.emit('whiteboard-tool-change', { width });
  };

  // --- Chat Functions ---

  /**
   * Sends a new chat message.
   */
  const sendMessage = (e) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() || !socketRef.current) return;
    
    const messageData = {
      id: Date.now().toString(),
      userId: peerRef.current?.id,
      userName: name,
      message: newMessage.trim(),
      type: 'user',
      timestamp: Date.now(),
      roomId
    };
    
    socketRef.current.emit('chat-message', messageData);
    setChatMessages(prev => [...prev, messageData]); // Add locally
    setNewMessage('');
  };

  /**
   * Handles 'Enter' key press for chat input (sends message).
   */
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /**
   * Formats a timestamp into a readable HH:MM time.
   */
  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

/**
 * Handles the submission of a message to the AI Host Assistant.
 * Manages UI state, constructs the payload with context, and handles the API lifecycle.
 *
 * @param {Event} e - The form submission event (optional).
 */

const sendHostAssistantMessage = async (e) => {
  if (e) e.preventDefault();
  if (!isHost) return;

  const trimmed = hostAssistantInput.trim();
  if (!trimmed || hostAssistantLoading) return;

  // 1. Setup User Message
  const userMessage = {
    id: Date.now().toString(),
    role: 'user',
    text: trimmed,
    createdAt: Date.now()
  };

  // 2. Setup Placeholder Assistant Message (Empty ID initially)
  const assistantMsgId = `assistant-${Date.now()}`;
  const initialAssistantMessage = {
    id: assistantMsgId,
    role: 'assistant',
    text: '', // Start empty, fill via stream
    createdAt: Date.now()
  };

  // 3. Optimistic Update: Add BOTH messages immediately
  const nextMessages = [...hostAssistantMessages, userMessage, initialAssistantMessage];
  setHostAssistantMessages(nextMessages);
  setHostAssistantInput('');
  setHostAssistantLoading(true);
  setHostAssistantError('');

  try {
    // Prepare payload (exclude the empty assistant message we just added)
    const payloadMessages = nextMessages.slice(0, -1).slice(-10).map((msg) => ({
      role: msg.role,
      text: msg.text
    }));

    const response = await fetch('http://localhost:3001/api/teacher-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: payloadMessages })
    });

    if (!response.ok) throw new Error('Network response was not ok');
    if (!response.body) throw new Error('ReadableStream not supported');

    // 4. Initialize Stream Reader
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let assistantText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode the chunk (this is raw text from our backend now)
      const chunk = decoder.decode(value, { stream: true });
      assistantText += chunk;

      // 5. Live State Update
      // We update the *last* message (our placeholder) with the accumulating text
      setHostAssistantMessages((prev) => {
        const newHistory = [...prev];
        const lastMsg = newHistory[newHistory.length - 1];
        
        // Ensure we are updating the correct message ID
        if (lastMsg.id === assistantMsgId) {
            lastMsg.text = assistantText;
        }
        return newHistory;
      });
    }

  } catch (error) {
    console.error('Streaming error:', error);
    setHostAssistantError('Connection interrupted.');
    
    // Optional: Remove the empty assistant message if it failed completely
    setHostAssistantMessages(prev => prev.filter(msg => msg.text.trim() !== ''));
  } finally {
    setHostAssistantLoading(false);
  }
};

/**
 * Enhanced UX for text input.
 * Allows 'Enter' to submit, but 'Shift+Enter' to create a new line.
 *
 * @param {KeyboardEvent} e - The keyboard event.
 */
const handleHostAssistantKeyDown = (e) => {
  // Check if Enter is pressed WITHOUT the Shift modifier
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault(); // Stop the newline character from being added to the input
    sendHostAssistantMessage(); // Trigger submission
  }
};

  // --- Attentiveness Functions ---

  /**
   * Toggles the attentiveness check (Host only).
   * Emits events to all participants to start/stop their models.
   */
  const toggleAttentivenessCheck = () => {
    if (!isHost) return;
    const socket = socketRef.current;
    if (!socket) return;
    
    const newState = !isCheckingAttentiveness;
    setIsCheckingAttentiveness(newState);

    if (newState) {
      // Tell participants to start monitoring
      socket.emit('start-attentiveness-check', { roomId });
      // Clear all local attentiveness statuses
      setParticipants(prev => new Map(
        Array.from(prev.entries()).map(([id, p]) => [
          id, 
          { ...p, attentiveness: undefined } // Clear old status
        ])
      ));
    } else {
      // Tell participants to stop monitoring
      socket.emit('stop-attentiveness-check', { roomId });
    }
  };

  /**
   * Memoized, sorted list of participants for the side drawer.
   * Sorts by:
   * 1. Host first
   * 2. 'low' attentiveness participants next
   * 3. Everyone else
   */
  const sortedParticipants = useMemo(() => {
    const participantArray = Array.from(participants.values());
    
    // Add "self" to the list if not host
    if (!isHost && peerRef.current?.id) {
      participantArray.push({ 
        userId: peerRef.current.id,
        stream: activeLocalStream,
        userName: name, 
        isHost: false, 
        micOn, 
        camOn,
        attentiveness: attentivenessStatusRef.current // Show my own status
      });
    }

    participantArray.sort((a, b) => {
      // Host always at the top
      if (a.isHost) return -1;
      if (b.isHost) return 1;

      const aAtt = a.attentiveness || 'high'; // Treat undefined as 'high'
      const bAtt = b.attentiveness || 'high';

      if (aAtt === 'low' && bAtt !== 'low') return -1; // 'low' bubbles up
      if (aAtt !== 'low' && bAtt === 'low') return 1;
      
      return 0; // Maintain original order otherwise
    });
    
    return participantArray;
  }, [participants, isHost, name, micOn, camOn, activeLocalStream]);

  // --- Participant & Media Management Callbacks ---

  /**
   * Adds a participant's stream to the state.
   * This is the central function for updating the `participants` Map.
   */
  const addParticipantVideo = useCallback((userId, userName, stream, userIsHost = false) => {
    // Handle host stream
    if (userIsHost) {
      hostIdRef.current = userId;
      hostStreamRef.current = stream;
      setHostStream(stream);
      setParticipants(prev => {
        const updated = new Map(prev);
        updated.set(userId, { userId, stream, userName, isHost: true, micOn: true, camOn: true });
        return updated;
      });
      return;
    }

    // Handle regular participant stream
    setParticipants(prev => {
      const existing = prev.get(userId);
      const newEntry = { 
        userId, 
        stream, 
        userName, 
        isHost: false, 
        micOn: existing?.micOn ?? true, // Preserve existing media state
        camOn: existing?.camOn ?? true 
      };
      const updated = new Map(prev);
      updated.set(userId, newEntry);
      return updated;
    });
  }, []);

  /**
   * Updates the `participants` Map with new mic/cam state.
   */
  const updateParticipantMediaFlags = useCallback(({ userId, micOn: m, camOn: c }) => {
    setParticipants(prev => {
      if (!prev.has(userId)) return prev;
      const updated = new Map(prev);
      const old = updated.get(userId);
      updated.set(userId, { ...old, micOn: m ?? old.micOn, camOn: c ?? old.camOn });
      return updated;
    });
  }, []);

  /**
   * Dials a new peer with the current active stream.
   * Sets up `ontrack` listener to handle stream replacements (e.g., screen share).
   */
  const dialPeer = useCallback((userId, userName, userIsHost, stream) => {
    if (!peerRef.current || !stream || userId === peerRef.current.id) return;
    try {
      const call = peerRef.current.call(userId, stream);
      peersRef.current.set(userId, call);
      
      // Listen for the initial stream
      call.on('stream', remoteStream => {
        addParticipantVideo(userId, userName, remoteStream, userIsHost);
      });
      
      // Listen for subsequent stream changes
      call.on('open', () => {
        if (call.peerConnection) {
          call.peerConnection.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
              // This is how we receive screen shares
              addParticipantVideo(userId, userName, event.streams[0], userIsHost);
            }
          };
        }
      });
      
      call.on('close', () => peersRef.current.delete(userId));
      call.on('error', (err) => console.warn('Call error for', userId, err));
    } catch (err) {
      console.warn('Dial peer failed', err);
    }
  }, [addParticipantVideo]);

  /**
   * Keeps `activeLocalStreamRef` in sync with `activeLocalStream` state
   * so that `peer.on('call')` can access the latest stream.
   */
  useEffect(() => {
    activeLocalStreamRef.current = activeLocalStream;
  }, [activeLocalStream]);

  /**
   * -------------------------------------------------------------
   * --- MAIN EFFECT: Socket.io, PeerJS, and Media Setup ---------
   * -------------------------------------------------------------
   * This is the core effect that runs on component mount.
   * It sets up all real-time listeners and media streams.
   */
  useEffect(() => {
    if (!name) return; // Don't connect if user hasn't entered name

    // 1. --- Initialize Socket.io ---
    const socket = io('http://localhost:3001',{
      path: '/socket.io/',
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      withCredentials: true
    });
    socketRef.current = socket;
    
    // 2. --- Socket Event Listeners ---

    socket.on('connect', () => {
      console.log('✅ [Client] Socket connected:', socket.id);
    });
    
    socket.on('connect_error', (err) => {
      console.error('❌ [Client] Socket connection error:', err);
    });

    // --- Screen Share Listeners ---
    socket.on('screen-share-started', ({ userId, userName }) => {
      setActiveScreenSharer({ userId, userName });
      setFeaturedId(null); // Screen share takes precedence over feature
      if (userId === peerRef.current?.id) {
        setScreenSharing(true);
      }
    });

    socket.on('screen-share-stopped', () => {
      setActiveScreenSharer(null);
      if (screenSharing) {
        setScreenSharing(false);
      }
    });

    socket.on('screen-share-busy', () => {
      alert('Someone else is already sharing their screen.');
      setScreenSharing(false);
      // Revert to camera stream if I tried to share
      const camStream = localStreamRef.current;
      if (camStream) {
        updateAllPeersWithStream(camStream);
        setActiveLocalStream(camStream);
        if (isHost) setHostStream(camStream);
      }
    });

    // --- Chat Listeners ---
    socket.on('chat-history', (messages) => setChatMessages(messages || []));
    socket.on('chat-message', (message) => {
      setChatMessages((prev) => {
        // Prevent duplicates
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
    });

    // --- Whiteboard Listeners ---
    socket.on('whiteboard-state', (state) => {
      if (state && state.elements) {
        setWhiteboardElements(state.elements);
        // Redraw canvas with all elements from history
        setTimeout(() => {
          if (canvasRef.current && contextRef.current) {
            redrawCanvas(state.elements);
          }
        }, 100); // Small delay to ensure canvas is ready
      }
    });

    socket.on('whiteboard-draw', (drawingData) => {
      setWhiteboardElements((prev) => {
        // Prevent duplicates from local echo
        const isDuplicate = prev.some(
          el => el.timestamp === drawingData.timestamp && el.userId === drawingData.userId
        );
        if (isDuplicate) return prev;
        return [...prev, drawingData];
      });
      // Draw the new element received from another user
      if (canvasRef.current && contextRef.current) {
        drawOnCanvas(drawingData);
      }
    });

    socket.on('whiteboard-clear', () => {
      setWhiteboardElements([]);
      if (contextRef.current && canvasRef.current) {
        const canvas = canvasRef.current;
        contextRef.current.clearRect(0, 0, canvas.width, canvas.height);
      }
    });

    socket.on('whiteboard-tool-change', ({ tool, color, width }) => {
      if (tool) setWhiteboardTool(tool);
      if (color) setWhiteboardColor(color);
      if (width) setWhiteboardWidth(width);
    });
    
    // Auto-open/close whiteboard for participants
    socket.on('whiteboard-opened', () => setWhiteboardOpen(true));
    socket.on('whiteboard-closed', () => setWhiteboardOpen(false));

    // --- User & Connection Listeners ---
    socket.on('existing-users', (users = []) => {
      // Store metadata for users already in the room
      profilesOrderRef.current = users.map(u => u.userId);
      users.forEach(({ userId, userName, isHost: otherIsHost, micOn, camOn }) => {
        profiles.current[userId] = { userName, isHost: otherIsHost, micOn: micOn ?? true, camOn: camOn ?? true };
        if (otherIsHost) hostIdRef.current = userId;
      });
    });

    socket.on('user-connected', ({ userId, userName, isHost: otherIsHost, micOn, camOn }) => {
      profilesOrderRef.current.push(userId);
      profiles.current[userId] = { userName, isHost: otherIsHost, micOn: micOn ?? true, camOn: camOn ?? true };
      
      // Dial the new user with my currently active stream
      const streamToDial = activeLocalStreamRef.current || localStreamRef.current;
      if (streamToDial) {
        dialPeer(userId, userName, otherIsHost, streamToDial);
      }
    });

    socket.on('user-disconnected', ({ userId }) => {
      peersRef.current.get(userId)?.close?.();
      peersRef.current.delete(userId);
      setParticipants(prev => {
        const updated = new Map(prev);
        updated.delete(userId);
        return updated;
      });
      if (hostIdRef.current === userId) {
        hostIdRef.current = null;
        hostStreamRef.current = null;
        setHostStream(null);
      }
      if (featuredId === userId) {
        setFeaturedId(null); // Un-feature if disconnected
      }
    });

    socket.on('user-media-updated', ({ userId, micOn: m, camOn: c }) => {
      profiles.current[userId] = { ...profiles.current[userId], micOn: m, camOn: c };
      updateParticipantMediaFlags({ userId, micOn: m, camOn: c });
    });

    // --- Attentiveness Listeners ---
    socket.on('start-attentiveness-check', () => setMonitoringActive(true));
    socket.on('stop-attentiveness-check', () => setMonitoringActive(false));
    socket.on('user-attentiveness-updated', ({ userId, status }) => {
      setParticipants(prev => {
        if (!prev.has(userId)) return prev;
        const updated = new Map(prev);
        const oldData = updated.get(userId);
        updated.set(userId, { ...oldData, attentiveness: status });
        return updated;
      });
    });

    // --- Room Listeners ---
    socket.on('host-left', ({ message }) => {
      alert(message || 'Host left. Class ended.');
      cleanup();
      navigate('/');
    });

    // 3. --- Initialize PeerJS ---
    const peer = new Peer(undefined, { 
      host: 'localhost', // TODO: Replace with deployed host
      port: 3002,        // TODO: Replace with deployed port
      path: '/peerjs',
      debug: 2,
      config: {
        iceServers: [ // STUN servers for NAT traversal
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });
    peerRef.current = peer;

    let mounted = true;

    // 4. --- Get Local Media (Camera/Mic) ---
    navigator.mediaDevices.getUserMedia({ video: videoConstraints.current, audio: true })
      .then(stream => {
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        console.log('📷 [Client] Local media obtained');
        
        localStreamRef.current = stream; // This is the persistent CAMERA stream
        setActiveLocalStream(stream); // Initially, the active stream is the camera
        stream.getVideoTracks()[0].enabled = camOn;
        stream.getAudioTracks()[0].enabled = micOn;

        if (isHost) {
          hostIdRef.current = peer.id;
          hostStreamRef.current = stream;
          setHostStream(stream);
        }

        // Attach to hidden local video ref (used for MediaPipe)
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.muted = true;
          localVideoRef.current.play?.().catch((e) =>  console.error('Video play error', e));
        }

        // 5. --- PeerJS Call Handler ---
        /**
         * This listener handles *incoming* calls from other peers.
         */
        peer.on('call', (call) => {
          // Answer the call with my *currently active* stream
          const streamToAnswer = activeLocalStreamRef.current || localStreamRef.current;
          call.answer(streamToAnswer);
          
          const info = profiles.current[call.peer] || { userName: 'Guest', isHost: false };
          
          // Listen for their initial stream
          call.on('stream', (remoteStream) => {
            addParticipantVideo(call.peer, info.userName, remoteStream, info.isHost);
          });
          
          // Listen for stream *replacements* (e.g., they start screen sharing)
          call.on('open', () => {
            if (call.peerConnection) {
              call.peerConnection.ontrack = (event) => {
                if (event.streams && event.streams[0]) {
                  addParticipantVideo(call.peer, info.userName, event.streams[0], info.isHost);
                }
              };
            }
          });
          
          call.on('close', () => peersRef.current.delete(call.peer));
          call.on('error', (err) => console.warn(`Call error with ${info.userName}:`, err));
          
          peersRef.current.set(call.peer, call);
        });

        // 6. --- Join Room ---
        const joinRoom = () => {
          if (peer.id && socket.connected) {
            console.log('🚀 [Client] Joining room:', roomId);
            socket.emit('join-room', { roomId, userId: peer.id, userName: name, isHost });
          }
        };

        // Wait for PeerJS to get an ID from the server
        if (peer.id) joinRoom();
        else peer.on('open', joinRoom);

        peer.on('open', (id) => {
        console.log('✅ [Client] PeerJS connected with ID:', id);
        joinRoom(); // Moved join logic here to ensure PeerID exists
      });
    
      peer.on('error', (err) => {
        console.error('❌ [Client] PeerJS error:', err);
      });
    })
    .catch(err => {
      console.error('getUserMedia failed:', err);
      alert(err.name === 'NotAllowedError' 
        ? 'Camera/Microphone access was denied. Please allow access and reload.'
        : `Unable to access camera/microphone: ${err.message || err.name}`
      );
    });


    // 7. --- Cleanup Function ---
    const cleanup = () => {
      mounted = false;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      peersRef.current.forEach(c => c.close?.());
      peerRef.current?.destroy?.();
      socketRef.current?.disconnect?.();
      setParticipants(new Map());
      setHostStream(null);
    };

    return cleanup;
  }, [name, roomId, isHost]); // This effect runs once

  /**
   * -------------------------------------------------------------
   * --- EFFECT: Attentiveness Detection (Participant-side) ------
   * -------------------------------------------------------------
   * This effect runs ONLY for participants (not host) AND
   * only when `monitoringActive` is true.
   * It loads the MediaPipe FaceLandmarker model and runs predictions.
   */
  useEffect(() => {
    if (isHost) return; // Host doesn't need to check themselves

    const videoElement = localVideoRef.current;
    const socket = socketRef.current;
    const peerId = peerRef.current?.id;

    // 1. Safety Checks
    if (!monitoringActive) {
      return;
    }
    
    if (!videoElement || !socket || !peerId) {
      console.warn('%c[ATTENTIVENESS] ❌ Cannot start: Missing video, socket, or peerId', 'color: #ef4444; font-weight: bold;');
      return;
    }

    console.log('%c╔══════════════════════════════════════════════════════════╗', 'color: #22c55e; font-weight: bold;');
    console.log('%c║     🚀 ATTENTIVENESS MONITORING STARTED                   ║', 'color: #22c55e; font-weight: bold;');
    console.log('%c╚══════════════════════════════════════════════════════════╝', 'color: #22c55e; font-weight: bold;');

    let lastVideoTime = -1;
    let animationFrameId;
    let lastCountdownSecond = -1;

    const getReasonText = (reason) => {
      switch(reason) {
        case 'NO_FACE': return '👤 No face detected - Please look at the camera';
        case 'EYES_CLOSED': return '😴 Eyes closed - Are you sleeping?';
        case 'LOOKING_AWAY': return '👀 Looking away - Please focus on the screen';
        default: return reason;
      }
    };

    const initializeAndStart = async () => {
      // Wait for Video to be READY
      if (videoElement.readyState < 2 || videoElement.videoWidth === 0) {
        console.log('%c[ATTENTIVENESS] ⏳ Waiting for video stream...', 'color: #f59e0b;');
        await new Promise(resolve => {
          videoElement.onloadeddata = () => resolve();
          const checkInterval = setInterval(() => {
             if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
               clearInterval(checkInterval);
               resolve();
             }
          }, 500);
        });
      }

      try {
        await videoElement.play();
      } catch (e) { /* ignore */ }

      console.log('%c[ATTENTIVENESS] 📹 Video ready: ' + videoElement.videoWidth + 'x' + videoElement.videoHeight, 'color: #22c55e;');

      // Load Model (if not already loaded)
      if (!faceLandmarkerRef.current) {
        console.log('%c[ATTENTIVENESS] 🤖 Loading AI model...', 'color: #3b82f6;');
        try {
            const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
            faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true,
                numFaces: 1
            });
            console.log('%c[ATTENTIVENESS] ✅ AI model loaded successfully', 'color: #22c55e; font-weight: bold;');
        } catch (err) {
            console.error('%c[ATTENTIVENESS] ❌ Model load failed:', 'color: #ef4444; font-weight: bold;', err.message);
            return;
        }
      }

      console.log('%c[ATTENTIVENESS] 🔄 Detection loop running...', 'color: #22c55e;');
      detectLoop();
    };

    const detectLoop = () => {
      if (!monitoringActive) return;

      if (videoElement.currentTime !== lastVideoTime) {
        lastVideoTime = videoElement.currentTime;
        
        if (faceLandmarkerRef.current) {
            try {
                const startTime = performance.now();
                const results = faceLandmarkerRef.current.detectForVideo(videoElement, startTime);
                analyzeResults(results);
            } catch (e) {
                console.error('%c[ATTENTIVENESS] Detection error:', 'color: #ef4444;', e.message);
            }
        }
      } 

      animationFrameId = requestAnimationFrame(detectLoop);
    };

    const analyzeResults = (results) => {
      let isDistracted = false;
      let reason = "";

      // A. No Face Detected
      if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
        isDistracted = true;
        reason = "NO_FACE";
      } else {
        const blendshapes = results.faceBlendshapes?.[0]?.categories || [];
        const eyeLeft = blendshapes.find(b => b.categoryName === 'eyeBlinkLeft')?.score || 0;
        const eyeRight = blendshapes.find(b => b.categoryName === 'eyeBlinkRight')?.score || 0;
        
        // B. Sleeping (Both eyes closed > 0.6)
        if (eyeLeft > 0.6 && eyeRight > 0.6) {
          isDistracted = true;
          reason = "EYES_CLOSED";
        } else {
           // C. Looking Away
           const landmarks = results.faceLandmarks[0];
           const nose = landmarks[1];
           const leftEar = landmarks[234];
           const rightEar = landmarks[454];
           
           const leftDist = Math.abs(nose.x - leftEar.x);
           const rightDist = Math.abs(nose.x - rightEar.x);
           const ratio = leftDist / (rightDist + 0.001);
           
           if (ratio > 2.5 || ratio < 0.4) {
               isDistracted = true;
               reason = "LOOKING_AWAY";
           }
        }
      }

      // --- Timer Logic with Countdown ---
      const now = Date.now();

      if (isDistracted) {
        if (!inattentiveStartTimeRef.current) {
          // First bad frame - start countdown
          inattentiveStartTimeRef.current = now;
          lastCountdownSecond = 10;
          console.log('%c┌──────────────────────────────────────────────────────────┐', 'color: #f59e0b; font-weight: bold;');
          console.log('%c│  ⚠️  DISTRACTION DETECTED                                │', 'color: #f59e0b; font-weight: bold;');
          console.log('%c│  Reason: ' + getReasonText(reason).padEnd(47) + '│', 'color: #f59e0b;');
          console.log('%c│  Starting 10 second countdown...                         │', 'color: #f59e0b;');
          console.log('%c└──────────────────────────────────────────────────────────┘', 'color: #f59e0b; font-weight: bold;');
        } else {
          // Ongoing distraction - show countdown
          const duration = now - inattentiveStartTimeRef.current;
          const elapsedSeconds = Math.floor(duration / 1000);
          const remainingSeconds = Math.max(0, 10 - elapsedSeconds);
          
          // Log countdown every second
          if (remainingSeconds !== lastCountdownSecond && remainingSeconds >= 0) {
            lastCountdownSecond = remainingSeconds;
            
            if (remainingSeconds > 0) {
              const progressBar = '█'.repeat(10 - remainingSeconds) + '░'.repeat(remainingSeconds);
              const countdownColor = remainingSeconds <= 3 ? '#ef4444' : remainingSeconds <= 6 ? '#f59e0b' : '#3b82f6';
              
              console.log(
                `%c[COUNTDOWN] ⏱️ ${remainingSeconds}s remaining │ ${progressBar} │ Reason: ${reason}`,
                `color: ${countdownColor}; font-weight: bold; font-size: 12px;`
              );
            }
          }

          // 10 Second Threshold - Alert host
          if (duration >= 10000) {
            if (attentivenessStatusRef.current !== 'low') {
                console.log('%c╔══════════════════════════════════════════════════════════╗', 'color: #ef4444; font-weight: bold;');
                console.log('%c║  🚨 ALERT: LOW ATTENTIVENESS REPORTED TO HOST            ║', 'color: #ef4444; font-weight: bold;');
                console.log('%c║  Reason: ' + getReasonText(reason).padEnd(47) + '║', 'color: #ef4444;');
                console.log('%c╚══════════════════════════════════════════════════════════╝', 'color: #ef4444; font-weight: bold;');
                attentivenessStatusRef.current = 'low';
                socket.emit('attentiveness-update', { userId: peerId, status: 'low', reason: reason });
            }
          }
        }
      } else {
        // User is attentive again
        if (inattentiveStartTimeRef.current) {
          const duration = now - inattentiveStartTimeRef.current;
          console.log(
            '%c[ATTENTIVENESS] ✅ Attentive again! (was distracted for ' + (duration/1000).toFixed(1) + 's)',
            'color: #22c55e; font-weight: bold;'
          );
        }
        inattentiveStartTimeRef.current = null;
        lastCountdownSecond = -1;
        
        if (attentivenessStatusRef.current === 'low') {
            console.log('%c[ATTENTIVENESS] ✨ Status restored to HIGH - notifying host', 'color: #22c55e; font-weight: bold;');
            attentivenessStatusRef.current = 'high';
            socket.emit('attentiveness-update', { userId: peerId, status: 'high' });
        }
      }
    };

    initializeAndStart();

    return () => {
      console.log('%c[ATTENTIVENESS] 🛑 Monitoring stopped', 'color: #6b7280;');
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      inattentiveStartTimeRef.current = null;
    };
  }, [monitoringActive, isHost]);

  /**
   * Auto-scrolls the chat window when new messages arrive.
   */
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  /**
   * -------------------------------------------------------------
   * --- EFFECT: Host Control Listeners (Participant-side) -------
   * -------------------------------------------------------------
   * This effect runs for participants to listen to commands
   * from the host (e.g., "mute yourself").
   */
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    /**
     * Handles a 'media-controlled-by-host' event.
     */
    const handleMediaControlledByHost = ({ action, value }) => {
      
      if (action === 'toggleMic' || action === 'muteAll') {
        const newMicState = (action === 'muteAll') ? false : (value ?? !micOn);
        setMicOn(newMicState);
        if (localStreamRef.current?.getAudioTracks()[0]) {
          localStreamRef.current.getAudioTracks()[0].enabled = newMicState;
        }
        // Respond to host
        socket.emit('media-control-response', { 
          userId: peerRef.current?.id, 
          micOn: newMicState, 
          camOn 
        });
      }
      
      if (action === 'toggleCam') {
        const newCamState = value ?? !camOn;
        setCamOn(newCamState);
        if (localStreamRef.current?.getVideoTracks()[0]) {
          localStreamRef.current.getVideoTracks()[0].enabled = newCamState;
        }
        // Respond to host
        socket.emit('media-control-response', { 
          userId: peerRef.current?.id, 
          micOn, 
          camOn: newCamState 
        });
      }
    };

    socket.on('media-controlled-by-host', handleMediaControlledByHost);
    
    return () => {
      socket.off('media-controlled-by-host', handleMediaControlledByHost);
    };
  }, [micOn, camOn, isHost]); // Depends on current media state

  /**
   * Sends a media control command to a specific participant (Host only).
   */
  const controlParticipantMedia = (userId, action, value) => {
    if (!isHost) return;
    
    socketRef.current?.emit('host-control-media', { 
      targetUserId: userId, 
      action, 
      value 
    });
  };

  // --- Local Media Toggle Functions ---

  /**
   * Toggles the local microphone on/off.
   */
  const toggleMic = useCallback(() => {
    setMicOn(prev => {
      const newState = !prev;
      // Update the local media stream track
      if (localStreamRef.current?.getAudioTracks()[0]) {
        localStreamRef.current.getAudioTracks()[0].enabled = newState;
      }
      // Notify other peers
      socketRef.current?.emit('media-toggle', { userId: peerRef.current?.id, micOn: newState });
      return newState;
    });
  }, []);

  /**
   * Toggles the local camera on/off.
   */
  const toggleCam = useCallback(() => {
    setCamOn(prev => {
      const newState = !prev;
      // Update the local media stream track
      if (localStreamRef.current?.getVideoTracks()[0]) {
        localStreamRef.current.getVideoTracks()[0].enabled = newState;
      }
      // Notify other peers
      socketRef.current?.emit('media-toggle', { userId: peerRef.current?.id, camOn: newState });
      return newState;
    });
  }, []);

  // --- Screen Share Functions ---

  /**
   * -------------------------------------------------------------
   * --- HELPER: updateAllPeersWithStream ------------------------
   * -------------------------------------------------------------
   * This is a critical function. It iterates through all active
   * PeerJS calls and uses `sender.replaceTrack()` to replace the
   * outgoing video/audio tracks. This is how we switch between
   * camera and screen share without dropping the call.
   */
  const updateAllPeersWithStream = useCallback((newStream) => {
    if (!peerRef.current) return;
    
    peersRef.current.forEach((call, targetUserId) => {
      try {
        const senders = call.peerConnection.getSenders();
        
        // Replace video track
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && newStream.getVideoTracks().length > 0) {
          videoSender.replaceTrack(newStream.getVideoTracks()[0])
            .catch(err => console.warn(`Failed to replace video track for ${targetUserId}:`, err));
        }
        
        // Replace audio track (if screen share includes audio)
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (audioSender && newStream.getAudioTracks().length > 0) {
          audioSender.replaceTrack(newStream.getAudioTracks()[0])
            .catch(err => console.warn(`Failed to replace audio track for ${targetUserId}:`, err));
        }
      } catch (error) {
        console.error(`Error updating stream for ${targetUserId}:`, error);
      }
    });
  }, []);

  /**
   * Toggles screen sharing on/off.
   */
  const toggleScreenShare = async () => {
    if (screenSharing) {
      // --- STOPPING screen sharing ---
      
      socketRef.current?.emit('stop-screen-share');
      
      const cameraStream = localStreamRef.current;
      if (cameraStream) {
        // Send camera stream back to all peers
        updateAllPeersWithStream(cameraStream);
        setActiveLocalStream(cameraStream); // Update local active stream
        if (isHost) setHostStream(cameraStream);
      }
      
      // Stop the screen share stream tracks
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      
      setScreenSharing(false);
    } else {
      // --- STARTING screen sharing ---
      
      // Check if someone else is already sharing
      if (activeScreenSharer && activeScreenSharer.userId !== peerRef.current?.id) {
        alert(`Cannot share screen. ${activeScreenSharer.userName} is already sharing.`);
        return;
      }

      try {
        // Get display media from browser
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always', displaySurface: 'window' },
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        
        screenStreamRef.current = displayStream;
        
        // Send screen share stream to all peers
        updateAllPeersWithStream(displayStream);
        setActiveLocalStream(displayStream); // Update local active stream
        
        if (isHost) setHostStream(displayStream);

        // Notify server
        socketRef.current.emit('start-screen-share', {
          userId: peerRef.current.id,
          userName: name
        });

        setScreenSharing(true);

        // Listen for when user clicks the browser "Stop sharing" button
        displayStream.getVideoTracks()[0].addEventListener('ended', () => {
          handleScreenShareEnded();
        });
        displayStream.getAudioTracks()[0]?.addEventListener('ended', () => {
          handleScreenShareEnded();
        });

      } catch (error) {
        if (error.name !== 'NotAllowedError') { // Ignore if user just clicks "Cancel"
          console.error('Screen share failed:', error);
          alert(`Screen sharing failed: ${error.message}`);
        }
        setScreenSharing(false);
      }
    }
  };

  /**
   * Helper function to clean up when screen sharing ends
   * (either by button or browser UI).
   */
  const handleScreenShareEnded = useCallback(() => {
    socketRef.current?.emit('stop-screen-share');
    
    // Revert to camera stream
    const cameraStream = localStreamRef.current;
    if (cameraStream) {
      updateAllPeersWithStream(cameraStream);
      setActiveLocalStream(cameraStream);
      if (isHost) setHostStream(cameraStream);
    }
    
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    
    setScreenSharing(false);
  }, [isHost, updateAllPeersWithStream]);

  // --- Other Event Handlers ---

  /**
   * Leaves the call, cleans up all connections and streams, and navigates home.
   */
  const handleEndCall = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    peersRef.current.forEach(c => c.close?.());
    peerRef.current?.destroy?.();
    socketRef.current?.disconnect?.();
    navigate('/');
  };

  /**
   * Copies the Room ID to the clipboard.
   */
  const handleCopyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // --- Memoized Layout Data ---

  /**
   * Memoized list of participants for the *sidebar*.
   * Includes "self" (if not host) and the first 2 other participants.
   * The rest are hidden behind the "More" button.
   */
  const gridList = useMemo(() => {
    const myPeerId = peerRef.current?.id;
    const result = [];
    
    // Add "self" if not the host
    if (!isHost) {
      result.push(['__me__', { 
        stream: activeLocalStream,
        userName: name, 
        isHost: false, 
        micOn, 
        camOn 
      }]);
    }
    
    // Add all other non-host participants
    Array.from(participants.entries()).forEach(([id, meta]) => {
      if (id !== myPeerId && !meta.isHost) {
        result.push([id, meta]);
      }
    });
    
    return result;
  }, [participants, isHost, name, micOn, camOn, activeLocalStream]);

  /**
   * Toggles the participant list drawer.
   */
  const toggleDrawer = () => setDrawerOpen(prev => !prev);
  
  /**
   * Toggles the "More Participants" video modal.
   */
  const toggleMoreParticipants = () => {
    setShowMoreParticipants(prev => !prev);
  };

  /**
   * Features a participant, showing them on the main display.
   */
  const featureParticipant = (id) => {
    if (activeScreenSharer) {
      alert('Cannot feature participant while screen sharing is active.');
      return;
    }
    setFeaturedId(id === featuredId ? null : id); // Toggle feature
    if (window.innerWidth < 768) setDrawerOpen(false); // Close drawer on mobile
  };

  /**
   * Memoized list of *all* participants for the side drawer list.
   */
  const allParticipants = useMemo(() => {
    const list = [];
    
    // Add host first
    if (hostIdRef.current && participants.has(hostIdRef.current)) {
      list.push([hostIdRef.current, participants.get(hostIdRef.current)]);
    }
    
    // Add self if not host
    if (!isHost) {
      list.push(['__me__', { 
        stream: activeLocalStream,
        userName: name, 
        isHost: false, 
        micOn, 
        camOn 
      }]);
    }
    
    // Add everyone else
    Array.from(participants.entries()).forEach(([id, meta]) => {
      if (!meta.isHost && id !== hostIdRef.current) {
        list.push([id, meta]);
      }
    });
    
    return list;
  }, [participants, isHost, name, micOn, camOn, activeLocalStream]);

  /**
   * Generates the array of objects for the control bar buttons.
   */
  const getControlButtons = () => {
    const participantCount = allParticipants.length;
    
    const buttons = [
      {
        icon: micOn ? IoMicOutline : IoMicOffOutline,
        label: micOn ? 'Mute' : 'Unmute',
        action: toggleMic,
        color: micOn ? 'from-green-500 to-emerald-600' : 'from-red-500 to-red-600',
        glow: micOn ? 'shadow-lg shadow-green-500/30' : ''
      },
      {
        icon: camOn ? IoVideocamOutline : IoVideocamOffOutline,
        label: camOn ? 'Turn off camera' : 'Turn on camera',
        action: toggleCam,
        color: camOn ? 'from-blue-500 to-cyan-600' : 'from-red-500 to-red-600',
        glow: camOn ? 'shadow-lg shadow-blue-500/30' : ''
      },
      {
        icon: IoDesktopOutline,
        label: screenSharing ? 'Stop sharing' : 'Share screen',
        action: toggleScreenShare,
        color: screenSharing ? 'from-purple-500 to-pink-600' : 'from-gray-600 to-gray-700',
        glow: screenSharing ? 'shadow-lg shadow-purple-500/30' : ''
      },
      {
        icon: IoChatbubbleOutline,
        label: chatOpen ? 'Close chat' : 'Open chat',
        action: () => setChatOpen(!chatOpen),
        color: chatOpen ? 'from-indigo-500 to-purple-600' : 'from-indigo-600 to-purple-700',
        glow: chatOpen ? 'shadow-lg shadow-indigo-500/30' : ''
      },
      {
        icon: IoPencil,
        label: whiteboardOpen ? 'Close whiteboard' : 'Open whiteboard',
        action: () => {
          if (isHost) {
            setWhiteboardOpen(!whiteboardOpen);
            socketRef.current?.emit(whiteboardOpen ? 'whiteboard-closed' : 'whiteboard-opened', { roomId });
          } else {
            setWhiteboardOpen(!whiteboardOpen);
          }
        },
        color: whiteboardOpen ? 'from-yellow-500 to-orange-600' : 'from-yellow-600 to-orange-700',
        glow: whiteboardOpen ? 'shadow-lg shadow-yellow-500/30' : ''
      },
      {
        icon: IoPeopleOutline,
        label: `Participants (${participantCount})`,
        action: toggleDrawer,
        color: drawerOpen ? 'from-pink-500 to-rose-600' : 'from-pink-600 to-rose-700',
        glow: drawerOpen ? 'shadow-lg shadow-pink-500/30' : ''
      },
      {
        icon: IoPowerOutline,
        label: 'Leave call',
        action: handleEndCall,
        color: 'from-red-600 to-red-700',
        glow: 'hover:shadow-lg hover:shadow-red-500/30'
      }
    ];

    if (isHost) {
      buttons.splice(4, 0, {
        icon: IoSparkles,
        label: hostAssistantOpen ? 'Close AI assistant' : 'Open AI assistant',
        action: () => {
          setHostAssistantOpen((prev) => !prev);
          setChatOpen(false);
          setWhiteboardOpen(false);
          setDrawerOpen(false);
        },
        color: hostAssistantOpen ? 'from-fuchsia-500 to-violet-600' : 'from-fuchsia-600 to-violet-700',
        glow: hostAssistantOpen ? 'shadow-lg shadow-fuchsia-500/40' : ''
      });
    }

    return buttons;
  };

  /**
   * Gets the text for the badge on the main display.
   */
  const getMainDisplayBadge = () => {
    const myPeerId = peerRef.current?.id;
    
    if (activeScreenSharer) {
      if (activeScreenSharer.userId === myPeerId) {
        return 'You (Sharing Screen)';
      }
      return `${activeScreenSharer.userName} (Sharing Screen)`;
    }
    
    if (featuredId) {
      if (featuredId === myPeerId) {
        return 'You (Featured)';
      }
      const participant = participants.get(featuredId);
      return `${participant?.userName || 'Participant'} (Featured)`;
    }

    if (isHost) {
      return 'You (Host)';
    }

    const host = profiles.current[hostIdRef.current];
    return `${host?.userName || 'Host'} (Host)`;
  };


  // --- JSX Render ---
  return (
    <div className="h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 text-white p-4 md:p-6 relative overflow-hidden flex flex-col">
      {/* Background elements */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent"></div>
        <div className="absolute top-0 left-0 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse animation-delay-2000"></div>
      </div>

      {/* --- Header --- */}
      <motion.header 
        initial={{ opacity: 0, y: -50 }}
        animate={{ opacity: 1, y: 0 }}
        className="h-16 flex items-center justify-between mb-4 flex-shrink-0"
      >
        <div className="flex items-center space-x-3">
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="relative">
            <div className="p-2 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl">
              <IoSparkles className="w-6 h-6 text-white" />
            </div>
          </motion.div>
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 text-transparent bg-clip-text">
            Ultimate Classroom
          </h1>
        </div>

        <div className="flex items-center space-x-3">
          {/* Room ID Display and Copy Button */}
          <motion.div whileHover={{ scale: 1.05 }} className="flex items-center space-x-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-xl border border-white/20">
            <span className="text-sm text-gray-200 font-medium">Room: {roomId}</span>
            <motion.button onClick={handleCopyRoomId} whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className="p-1 hover:bg-white/10 rounded-lg">
              <IoCopyOutline className="w-4 h-4" />
            </motion.button>
            <AnimatePresence>
              {isCopied && (
                <motion.span initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0 }} className="text-xs text-green-400 font-medium">
                  Copied!
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </motion.header>

      {/* --- "Enter Name" Form --- */}
      {/* This renders if the user landed here without a 'name' query param */}
      {!name ? (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md mx-auto bg-white/10 backdrop-blur-md p-8 rounded-2xl border border-white/20 shadow-2xl mt-20">
          <h2 className="text-2xl font-bold text-center mb-6 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Join the Classroom
          </h2>
          <div className="space-y-4">
            <input type="text" placeholder="Enter your name" className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { setIsHost(true); setName(e.target.value.trim()); } }} />
            <motion.button onClick={(e) => { const input = e.target.previousSibling; if (input?.value.trim()) { setIsHost(true); setName(input.value.trim()); } }} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl font-semibold text-white shadow-lg hover:shadow-xl transition-all">
              Enter Classroom
            </motion.button>
          </div>
        </motion.div>
      ) : (
        <>
          {/* --- Main Content Layout --- */}
          <div className="flex-1 min-h-0 overflow-hidden flex gap-2 md:gap-4 h-full">
            
            {/* Left Sidebar - Participants (Fixed Width) */}
            <div className="w-64 md:w-72 flex-shrink-0 overflow-y-auto space-y-3 pb-2 relative z-20">
              
              {/* First Participant Tile (from gridList) */}
              {gridList.length > 0 && (
                <ParticipantVideoTile
                  key={`grid-0-${gridList[0][0]}`}
                  userId={gridList[0][0]}
                  meta={gridList[0][1]}
                  isMe={gridList[0][0] === '__me__'}
                  isFeatured={featuredId === gridList[0][0]}
                  onFeature={() => featureParticipant(gridList[0][0])}
                />
              )}

              {/* Second Participant Tile (from gridList) */}
              {gridList.length > 1 && (
                <ParticipantVideoTile
                  key={`grid-1-${gridList[1][0]}`}
                  userId={gridList[1][0]}
                  meta={gridList[1][1]}
                  isMe={gridList[1][0] === '__me__'}
                  isFeatured={featuredId === gridList[1][0]}
                  onFeature={() => featureParticipant(gridList[1][0])}
                />
              )}

              {/* "More Participants" Button */}
              {gridList.length > 2 && (
                <motion.button
                  onClick={toggleMoreParticipants} // Opens the video modal
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full h-40 md:h-48 rounded-lg bg-gradient-to-br from-purple-600/40 to-blue-600/40 border-2 border-dashed border-white/20 hover:border-white/40 transition-all flex flex-col items-center justify-center group cursor-pointer relative z-30"
                  style={{ pointerEvents: 'auto' }}
                >
                  <div className="text-center p-4">
                    <IoPeopleOutline className="w-8 h-8 text-white mx-auto mb-2 group-hover:scale-110 transition-transform" />
                    <p className="text-sm font-semibold text-white">+{gridList.length - 2}</p>
                    <p className="text-xs text-gray-300 mt-1">More Participants</p>
                  </div>
                </motion.button>
              )}
            </div>

            {/* Main Display Area - Host/Featured/Screen Share */}
            <div className="flex-1 min-w-0 overflow-hidden h-full">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full h-full flex items-center justify-center overflow-hidden"
              >
                <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 bg-black/50">
                  {/* This video element renders the mainDisplayStream */}
                  <video 
                    ref={hostVideoRef}
                    autoPlay 
                    playsInline 
                    className="w-full h-full object-contain" // object-contain to see full screen
                  />
                  
                  {/* Camera Off Overlay Logic */}
                  {(() => {
                    let camIsOff = false;
                    
                    if (activeScreenSharer) {
                      camIsOff = false; // Never show overlay during screen share
                    } else if (featuredId) {
                      camIsOff = !participants.get(featuredId)?.camOn;
                    } else {
                      // Default to host
                      camIsOff = isHost ? !camOn : !(profiles.current[hostIdRef.current]?.camOn ?? true);
                    }

                    if (camIsOff) {
                      return (
                        <div className="absolute inset-0 bg-gradient-to-br from-gray-900/80 to-black/80 backdrop-blur-sm flex items-center justify-center">
                          <div className="text-center">
                            <IoVideocamOffOutline className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                            <p className="text-gray-300 font-medium text-lg">Camera is off</p>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}

                  {/* Main Display Badge */}
                  <div className="absolute top-4 left-4 bg-gradient-to-r from-yellow-500 to-orange-500 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg flex items-center gap-2">
                    <span>{getMainDisplayBadge()}</span>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>

          {/* --- Chat Panel (Drawer) --- */}
          <AnimatePresence>
            {chatOpen && (
              <>
                {/* Backdrop */}
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setChatOpen(false)} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
                {/* Panel */}
                <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30 }} className="fixed top-0 right-0 h-full w-80 md:w-96 bg-gradient-to-b from-gray-900/95 to-blue-900/95 backdrop-blur-xl border-l border-white/20 z-50 shadow-2xl">
                  <div className="p-6 h-full flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">Class Chat</h3>
                      <motion.button onClick={() => setChatOpen(false)} whileHover={{ scale: 1.1, rotate: 90 }} className="p-2 hover:bg-white/10 rounded-lg">
                        <IoClose className="w-5 h-5" />
                      </motion.button>
                    </div>
                    
                    {/* Message List */}
                    <div className="flex-1 overflow-y-auto space-y-3 mb-4">
                      {chatMessages.length === 0 ? (
                        <div className="text-center text-gray-400 py-8">
                          No messages yet. Start the conversation!
                        </div>
                      ) : (
                        chatMessages.map((msg, index) => (
                          <motion.div 
                            key={msg.id || index} 
                            initial={{ opacity: 0, y: 10 }} 
                            animate={{ opacity: 1, y: 0 }}
                            className={`p-3 rounded-lg ${
                              msg.type === 'system' 
                                ? 'bg-yellow-500/20 text-yellow-300 text-center text-sm' 
                                : msg.userId === peerRef.current?.id 
                                ? 'bg-blue-500/20 ml-4' // My messages
                                : 'bg-white/5 mr-4' // Others' messages
                            }`}
                          >
                            {msg.type === 'system' ? (
                              <div className="flex items-center justify-center space-x-2">
                                <span className="italic">{msg.message}</span>
                                <span className="text-xs opacity-75">
                                  {formatTime(msg.timestamp || Date.now())}
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="flex justify-between items-center mb-1">
                                  <span className={`font-semibold ${
                                    msg.userId === peerRef.current?.id ? 'text-blue-300' : 'text-gray-300'
                                  }`}>
                                    {msg.userName} {msg.userId === peerRef.current?.id && '(You)'}
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    {formatTime(msg.timestamp || Date.now())}
                                  </span>
                                </div>
                                {/* Use renderMessageContent to handle files/links */}
                                {renderMessageContent(msg)}
                              </>
                            )}
                          </motion.div>
                        ))
                      )}
                      {/* Auto-scroll target */}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Chat Input Form */}
                    <form onSubmit={sendMessage} className="flex space-x-2">
                      <input 
                        type="text" 
                        value={newMessage} 
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={handleKeyPress}
                        placeholder="Type a message or paste link..." 
                        className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" 
                      />
                      
                      {/* Hidden file input */}
                      <input
                        type="file"
                        id="file-upload"
                        style={{ display: 'none' }}
                        onChange={handleFileUpload}
                        disabled={fileUploading}
                      />
                      {/* File upload button */}
                      <motion.label
                        htmlFor="file-upload"
                        whileHover={{ scale: fileUploading ? 1 : 1.05 }}
                        whileTap={{ scale: fileUploading ? 1 : 0.95 }}
                        className={`p-2 rounded-lg cursor-pointer transition-all ${
                          fileUploading 
                            ? 'bg-gray-600 cursor-not-allowed' 
                            : 'bg-gradient-to-r from-green-500 to-emerald-500 hover:shadow-lg'
                        }`}
                        title="Upload file (max 5MB)"
                      >
                        {fileUploading ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <IoDocumentOutline className="w-5 h-5 text-white" />
                        )}
                      </motion.label>
                      
                      {/* Send Button */}
                      <motion.button 
                        type="submit"
                        whileHover={{ scale: 1.05 }} 
                        whileTap={{ scale: 0.95 }} 
                        className="p-2 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg disabled:opacity-50 hover:shadow-lg transition-shadow"
                        disabled={!newMessage.trim() && !fileUploading}
                      >
                        <IoSend className="w-5 h-5" />
                      </motion.button>
                    </form>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {hostAssistantOpen && isHost && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setHostAssistantOpen(false)}
                  className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
                />
                <motion.div
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 30 }}
                  className="fixed top-0 right-0 h-full w-full sm:w-96 md:w-[30rem] bg-gradient-to-b from-slate-950/95 via-slate-900/95 to-violet-900/95 backdrop-blur-xl border-l border-white/20 z-50 shadow-2xl"
                >
                  <div className="p-6 h-full flex flex-col space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <IoSparkles className="w-5 h-5 text-violet-300" />
                          <h3 className="text-xl font-bold bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-transparent">
                            AI Teaching Assistant
                          </h3>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">
                          Host-only assistant for explanations, summaries and quiz ideas.
                        </p>
                      </div>
                      <motion.button
                        onClick={() => setHostAssistantOpen(false)}
                        whileHover={{ scale: 1.1, rotate: 90 }}
                        className="p-2 hover:bg-white/10 rounded-lg"
                      >
                        <IoClose className="w-5 h-5" />
                      </motion.button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                      {hostAssistantMessages.length === 0 ? (
                        <div className="mt-8 text-center text-gray-400 text-sm">
                          Ask about explaining a concept, generating quiz questions, or summarizing the discussion.
                        </div>
                      ) : (
                        hostAssistantMessages.map((msg) => (
                          <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={`p-3 rounded-lg text-sm ${
                              msg.role === 'assistant'
                                ? 'bg-violet-500/20 border border-violet-400/40'
                                : 'bg-white/5 border border-white/10'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-xs text-gray-300">
                                {msg.role === 'assistant' ? 'Assistant' : 'You'}
                              </span>
                              {msg.createdAt && (
                                <span className="text-[10px] text-gray-500">
                                  {formatTime(msg.createdAt)}
                                </span>
                              )}
                            </div>
                            <p className="text-gray-100 whitespace-pre-wrap leading-relaxed">
                              {msg.text}
                            </p>
                          </motion.div>
                        ))
                      )}

                      {hostAssistantLoading && (
                        <div className="flex items-center space-x-2 text-xs text-gray-400">
                          <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                          <span>Thinking...</span>
                        </div>
                      )}
                      <div ref={hostAssistantEndRef} />
                    </div>

                    {hostAssistantError && (
                      <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                        {hostAssistantError}
                      </div>
                    )}

                    <form onSubmit={sendHostAssistantMessage} className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {[
                          'What is the sliding window technique?',
                          'Explain the economic impact of climate change.',
                          'Suggest some quiz questions on photosynthesis.',
                        ].map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => setHostAssistantInput(suggestion)}
                            className="px-3 py-1 rounded-full bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 border border-white/10 transition-colors"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>

                      <div className="flex space-x-2">
                        <textarea
                          value={hostAssistantInput}
                          onChange={(e) => setHostAssistantInput(e.target.value)}
                          onKeyDown={handleHostAssistantKeyDown}
                          rows={2}
                          placeholder="Ask the assistant to help you plan, explain or create exercises..."
                          className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-sm text-white placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                        <motion.button
                          type="submit"
                          disabled={!hostAssistantInput.trim() || hostAssistantLoading}
                          whileHover={{
                            scale: hostAssistantInput.trim() && !hostAssistantLoading ? 1.05 : 1
                          }}
                          whileTap={{
                            scale: hostAssistantInput.trim() && !hostAssistantLoading ? 0.95 : 1
                          }}
                          className="self-end p-3 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 disabled:opacity-40 text-white shadow-lg"
                        >
                          <IoSend className="w-5 h-5" />
                        </motion.button>
                      </div>
                    </form>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* --- Whiteboard Panel (Drawer) --- */}
          <AnimatePresence>
            {whiteboardOpen && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setWhiteboardOpen(false)} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
                <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30 }} className="fixed top-0 right-0 h-full w-full md:w-3/4 bg-gradient-to-b from-gray-900/95 to-purple-900/95 backdrop-blur-xl border-l border-white/20 z-50 shadow-2xl">
                  <div className="p-6 h-full flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                        Collaborative Whiteboard {!isHost && '(View Only)'}
                      </h3>
                      <motion.button onClick={() => setWhiteboardOpen(false)} whileHover={{ scale: 1.1, rotate: 90 }} className="p-2 hover:bg-white/10 rounded-lg">
                        <IoClose className="w-5 h-5" />
                      </motion.button>
                    </div>

                    {/* Host Toolbar */}
                    {isHost ? (
                      <div className="flex flex-col space-y-3 mb-4 p-3 bg-white/10 rounded-lg">
                        {/* Tools: Pen, Eraser, Text */}
                        <div className="flex items-center space-x-2">
                          {[
                            { name: 'pen', icon: IoPencil, label: 'Pen' },
                            { name: 'eraser', icon: IoBrushOutline, label: 'Eraser' },
                            { name: 'text', icon: IoText, label: 'Text' }
                          ].map((tool) => (
                            <motion.button
                              key={tool.name}
                              onClick={() => changeWhiteboardTool(tool.name)}
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              className={`p-2 rounded-lg flex flex-col items-center min-w-16 ${
                                whiteboardTool === tool.name 
                                  ? 'bg-blue-500 text-white' 
                                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
                              }`}
                              title={tool.label}
                            >
                              <tool.icon className="w-5 h-5" />
                              <span className="text-xs mt-1">{tool.label}</span>
                            </motion.button>
                          ))}
                        </div>

                        {/* Color and Size Controls */}
                        <div className="flex items-center space-x-4">
                          <div className="flex items-center space-x-2">
                            <IoColorPalette className="w-5 h-5 text-gray-400" />
                            <input 
                              type="color" 
                              value={whiteboardColor} 
                              onChange={(e) => changeWhiteboardColor(e.target.value)} 
                              className="w-8 h-8 rounded border-none cursor-pointer" 
                            />
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <span className="text-sm text-gray-400">Size:</span>
                            <input 
                              type="range" 
                              min="1" 
                              max="20" 
                              value={whiteboardWidth} 
                              onChange={(e) => changeWhiteboardWidth(parseInt(e.target.value))} 
                              className="w-20" 
                            />
                            <span className="text-xs text-gray-400 w-8">{whiteboardWidth}px</span>
                          </div>
                        </div>

                        {/* Text Tool UI (Conditional) */}
                        {isTextMode && textPosition && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="flex flex-col space-y-2 p-3 bg-blue-500/20 rounded border border-blue-400/30"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium text-blue-300">
                                📍 Text at: {Math.round(textPosition.x)}, {Math.round(textPosition.y)}
                              </span>
                              <motion.button
                                onClick={cancelTextPlacement}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                                title="Cancel text placement"
                              >
                                <IoClose className="w-4 h-4" />
                              </motion.button>
                            </div>
                            
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={whiteboardText}
                                onChange={(e) => setWhiteboardText(e.target.value)}
                                placeholder="Type your text here..."
                                className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') addTextToWhiteboard();
                                  else if (e.key === 'Escape') cancelTextPlacement();
                                }}
                                autoFocus
                              />
                              <motion.button
                                onClick={addTextToWhiteboard}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                disabled={!whiteboardText.trim()}
                                className="px-4 py-2 bg-green-500 disabled:bg-gray-600 rounded text-white font-medium text-sm flex items-center space-x-1"
                              >
                                <IoSend className="w-3 h-3" />
                                <span>Add</span>
                              </motion.button>
                            </div>
                            
                            {isPlacingText && (
                              <div className="text-xs text-yellow-300 flex items-center space-x-1">
                                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                                <span>Drag to position text, release to confirm location</span>
                              </div>
                            )}
                          </motion.div>
                        )}
                        {isTextMode && !textPosition && (
                          <div className="text-sm text-blue-300 p-2 bg-blue-500/10 rounded border border-blue-400/20 text-center">
                            🖱️ Click and drag on the canvas to place text
                          </div>
                        )}

                        {/* Undo / Clear Controls */}
                        <div className="flex items-center space-x-2 pt-2 border-t border-white/10">
                          <motion.button 
                            onClick={undoWhiteboard}
                            whileHover={{ scale: 1.1 }} 
                            whileTap={{ scale: 0.9 }} 
                            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg flex items-center space-x-1 flex-1 justify-center"
                            title="Undo"
                          >
                            <IoArrowUndo className="w-5 h-5" />
                            <span className="text-sm">Undo</span>
                          </motion.button>
                          
                          <motion.button 
                            onClick={clearWhiteboard}
                            whileHover={{ scale: 1.1 }} 
                            whileTap={{ scale: 0.9 }} 
                            className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg flex items-center space-x-1 flex-1 justify-center"
                            title="Clear Whiteboard"
                          >
                            <IoTrash className="w-5 h-5" />
                            <span className="text-sm">Clear</span>
                          </motion.button>
                        </div>
                      </div>
                    ) : (
                      // Participant "View Only" Message
                      <div className="mb-4 p-3 bg-yellow-500/20 rounded-lg text-yellow-300 text-center">
                        View only mode. Only the host can draw on the whiteboard.
                      </div>
                    )}

                    {/* Canvas Element */}
                    <div className="flex-1 bg-white rounded-lg overflow-hidden">
                      <canvas
                        ref={canvasRef}
                        // Only attach handlers if host
                        onMouseDown={isHost ? startDrawing : undefined}
                        onMouseMove={isHost ? draw : undefined}
                        onMouseUp={isHost ? stopDrawing : undefined}
                        onMouseLeave={isHost ? stopDrawing : undefined}
                        onTouchStart={isHost ? (e) => {
                          e.preventDefault();
                          startDrawing(e.touches[0]);
                        } : undefined}
                        onTouchMove={isHost ? (e) => {
                          e.preventDefault();
                          draw(e.touches[0]);
                        } : undefined}
                        onTouchEnd={isHost ? stopDrawing : undefined}
                        className={`w-full h-full ${
                          isHost && isTextMode ? 'cursor-crosshair' : 
                          isHost ? 'cursor-crosshair' : 'cursor-default'
                        } touch-none`}
                      />
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>            

          {/* --- Participant List (Drawer) --- */}
          <AnimatePresence>
            {drawerOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={toggleDrawer}
                  className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
                />
                
                <motion.div
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 30 }}
                  className="fixed top-0 right-0 h-full w-80 md:w-96 bg-gradient-to-b from-gray-900/95 to-purple-900/95 backdrop-blur-xl border-l border-white/20 z-50 shadow-2xl"
                >
                  <div className="p-6 h-full flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                        Participants ({allParticipants.length})
                      </h3>
                      <motion.button
                        onClick={toggleDrawer}
                        whileHover={{ scale: 1.1, rotate: 90 }}
                        className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <IoClose className="w-5 h-5" />
                      </motion.button>
                    </div>

                    {/* Participant List */}
                    <div className="flex-1 overflow-y-auto space-y-3">
                      {/* Use the memoized, sorted list */}
                      {sortedParticipants.map((meta, index) => (
                        <motion.div
                          key={meta.userId}
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: index * 0.1 }}
                          whileHover={{ scale: 1.02 }}
                          className={`p-4 rounded-xl backdrop-blur-sm border transition-all ${
                            meta.userId === featuredId 
                              ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 border-blue-400/50' 
                              : 'bg-white/5 border-white/10'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            {/* Left Side: Info */}
                            <div className="flex items-center space-x-3">
                              {/* Attentiveness Status Icon */}
                              {meta.attentiveness === 'low' && (
                                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" title="Low Attentiveness"></div>
                              )}
                              <div className={`w-3 h-3 rounded-full ${meta.isHost ? 'bg-yellow-400' : 'bg-green-400'}`}></div>
                              <div>
                                <div className="font-semibold text-white">
                                  {meta.userId === peerRef.current?.id ? `${meta.userName} (You)` : meta.userName}
                                  {meta.isHost && ' (Host)'}
                                </div>
                                {/* Attentiveness Status Text */}
                                {meta.attentiveness === 'low' && (
                                  <div className="text-xs font-medium text-red-400 animate-pulse">Attentiveness: Low</div>
                                )}
                                {/* Media Status Text */}
                                <div className="text-xs text-gray-400 flex items-center space-x-2">
                                  <span>{meta.isHost ? 'Host' : 'Participant'}</span>
                                  <span>•</span>
                                  <span className={`flex items-center space-x-1 ${meta.micOn ? 'text-green-400' : 'text-red-400'}`}>
                                    <IoMicOutline className="w-3 h-3" />
                                    <span>{meta.micOn ? 'On' : 'Off'}</span>
                                  </span>
                                  <span>•</span>
                                  <span className={`flex items-center space-x-1 ${meta.camOn ? 'text-green-400' : 'text-red-400'}`}>
                                    <IoVideocamOutline className="w-3 h-3" />
                                    <span>{meta.camOn ? 'On' : 'Off'}</span>
                                  </span>
                                </div>
                              </div>
                            </div>
                            
                            {/* Right Side: Controls */}
                            <div className="flex items-center space-x-1">
                              {/* Host Controls (for others) */}
                              {meta.userId !== peerRef.current?.id && !meta.isHost && isHost && (
                                <>
                                  <motion.button
                                    onClick={() => controlParticipantMedia(meta.userId, 'toggleMic', !meta.micOn)}
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    className={`p-2 rounded-lg transition-colors ${
                                      meta.micOn 
                                        ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                                        : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                    }`}
                                    title={meta.micOn ? 'Mute participant' : 'Unmute participant'}
                                  >
                                    {meta.micOn ? <IoMicOutline className="w-4 h-4" /> : <IoMicOffOutline className="w-4 h-4" />}
                                  </motion.button>
                                  <motion.button
                                    onClick={() => controlParticipantMedia(meta.userId, 'toggleCam', !meta.camOn)}
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    className={`p-2 rounded-lg transition-colors ${
                                      meta.camOn 
                                        ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                                        : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                    }`}
                                    title={meta.camOn ? 'Turn off camera' : 'Turn on camera'}
                                  >
                                    {meta.camOn ? <IoVideocamOutline className="w-4 h-4" /> : <IoVideocamOffOutline className="w-4 h-4" />}
                                  </motion.button>
                                </>
                              )}
                              
                              {/* Feature Button (for non-host, non-self) */}
                              {meta.userId !== peerRef.current?.id && !meta.isHost && (
                                <motion.button
                                  onClick={() => featureParticipant(meta.userId)}
                                  whileHover={{ scale: 1.1 }}
                                  whileTap={{ scale: 0.9 }}
                                  className={`p-2 rounded-lg transition-colors ${
                                    meta.userId === featuredId 
                                      ? 'bg-yellow-500/20 text-yellow-400' 
                                      : 'bg-white/10 hover:bg-white/20'
                                  }`}
                                  disabled={!!activeScreenSharer} // Can't feature while sharing
                                  title={activeScreenSharer ? 'Cannot feature while sharing' : 'Feature participant'}
                                >
                                  <IoStar className={`w-4 h-4 ${meta.userId === featuredId ? 'fill-yellow-400' : ''}`} />
                                </motion.button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>

                    {/* Host Bulk Controls */}
                    {isHost && allParticipants.some(p => !p[1].isHost && p[0] !== '__me__') && (
                      <div className="py-4 border-t border-white/10">
                        <h4 className="text-sm font-semibold text-gray-300 mb-2">Bulk Controls</h4>
                        <div className="flex space-x-2">
                          <motion.button
                            onClick={() => allParticipants.forEach(([id, meta]) => {
                              if (!meta.isHost && id !== '__me__') {
                                controlParticipantMedia(id, 'muteAll', true);
                              }
                            })}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="flex-1 py-2 bg-gradient-to-r from-red-600 to-orange-600 rounded-xl font-semibold text-white text-sm flex items-center justify-center space-x-1"
                          >
                            <IoMicOffOutline className="w-4 h-4" />
                            <span>Mute All</span>
                          </motion.button>

                          <motion.button
                            onClick={toggleAttentivenessCheck}
                            className={`flex-1 py-2 rounded-lg text-white font-medium transition-colors ${
                              isCheckingAttentiveness 
                                ? 'bg-red-600 hover:bg-red-700' 
                                : 'bg-green-600 hover:bg-green-700'
                            }`}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.98 }}
                          >
                            {isCheckingAttentiveness ? 'Stop Attentiveness Check' : 'Start Attentiveness Check'}
                          </motion.button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* --- "More Participants" Video Modal --- */}
          <AnimatePresence>
            {showMoreParticipants && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={toggleMoreParticipants}
                  className="fixed inset-0 bg-black/70 backdrop-blur-md z-50"
                />
                
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-11/12 h-5/6 max-w-6xl bg-gradient-to-br from-gray-900 to-purple-900 border border-white/20 rounded-2xl shadow-2xl z-50 overflow-hidden"
                >
                  <div className="flex flex-col h-full">
                    {/* Modal Header */}
                    <div className="flex items-center justify-between p-6 border-b border-white/10 bg-black/20">
                      <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                        All Participants ({gridList.slice(2).length})
                      </h3>
                      <motion.button
                        onClick={toggleMoreParticipants}
                        whileHover={{ scale: 1.1, rotate: 90 }}
                        whileTap={{ scale: 0.9 }}
                        className="p-3 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
                      >
                        <IoClose className="w-6 h-6 text-white" />
                      </motion.button>
                    </div>

                    {/* Participants Video Grid */}
                    <div className="flex-1 overflow-y-auto p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {/* Render only participants not in the sidebar */}
                        {gridList.slice(2).map(([id, meta]) => (
                          <div key={`modal-${id}`} className="flex justify-center">
                            <div className="w-full aspect-video rounded-lg overflow-hidden shadow-lg border border-white/10 bg-black/20">
                              <div className="relative w-full h-full">
                                {/* Lightweight video element */}
                                <video
                                  key={`modal-${id}-video`}
                                  autoPlay
                                  playsInline
                                  muted={id === '__me__'}
                                  className="w-full h-full object-cover"
                                  ref={(el) => {
                                    // Attach stream using ref callback
                                    if (el && meta.stream) {
                                      el.srcObject = meta.stream;
                                      el.play().catch(() => {});
                                    }
                                  }}
                                />
                                
                                {!meta.camOn && (
                                  <div className="absolute inset-0 bg-gradient-to-br from-gray-900/60 to-black/60 flex items-center justify-center">
                                    <IoVideocamOffOutline className="w-6 h-6 text-gray-400" />
                                  </div>
                                )}

                                {/* Simplified Info Overlay */}
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-white font-medium text-xs truncate">
                                      {id === '__me__' ? `${meta.userName} (You)` : meta.userName}
                                      {meta.isHost && ' (Host)'}
                                    </span>
                                    <div className="flex items-center space-x-1">
                                      {!meta.micOn && <IoMicOffOutline className="w-3 h-3 text-red-400" />}
                                      {!meta.camOn && <IoVideocamOffOutline className="w-3 h-3 text-red-400" />}
                                    </div>
                                  </div>
                                </div>

                                {/* Feature Button */}
                                {id !== '__me__' && (
                                  <motion.button
                                    onClick={() => {
                                      featureParticipant(id);
                                      setShowMoreParticipants(false); // Close modal on feature
                                    }}
                                    whileHover={{ scale: 1.1 }}
                                    whileTap={{ scale: 0.9 }}
                                    className="absolute top-1 right-1 bg-black/50 hover:bg-blue-600/80 rounded-full p-1 transition-colors"
                                  >
                                    <IoStar className={`w-3 h-3 ${featuredId === id ? 'text-yellow-400' : 'text-white'}`} />
                                  </motion.button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="p-4 border-t border-white/10 bg-black/20 text-center">
                      <p className="text-sm text-gray-400">
                        Click the star icon to feature a participant on the main screen
                      </p>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* --- Control Bar --- */}
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: 0.4 }} 
            className="relative z-30"
          >
            <div className="bg-black/60 backdrop-blur-xl px-4 py-3 rounded-2xl border border-white/20 shadow-2xl">
              <div className="flex items-center justify-center gap-3 md:gap-4">
                {/* Generate buttons from the memoized function */}
                {getControlButtons().map((button, index) => (
                  <motion.button
                    key={index}
                    onClick={button.action}
                    className={`relative p-3 md:p-4 rounded-xl bg-gradient-to-r ${button.color} ${button.glow} transition-all duration-300 group`}
                    whileHover={{ 
                      scale: 1.1, 
                      y: -2,
                      transition: { duration: 0.2 }
                    }}
                    whileTap={{ 
                      scale: 0.9,
                      transition: { duration: 0.1 }
                    }}
                  >
                    <button.icon className="w-5 h-5 md:w-6 md:h-6 text-white" />
                    
                    {/* Tooltip */}
                    <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-black/90 backdrop-blur-sm text-white text-xs py-2 px-3 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg">
                      {button.label}
                      <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1 w-2 h-2 bg-black/90 rotate-45"></div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Hidden local preview video (for MediaPipe) - must have dimensions for MediaPipe to work */}
          <video 
            ref={localVideoRef} 
            style={{ 
              position: 'absolute',
              width: '1px',
              height: '1px',
              opacity: 0,
              pointerEvents: 'none',
              zIndex: -1
            }} 
            muted 
            playsInline 
            autoPlay
          />
        </>
      )}
    </div>
  );
}

export default Room;