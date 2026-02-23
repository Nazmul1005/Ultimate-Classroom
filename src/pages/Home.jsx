/**
 * Home.jsx
 * * This component renders the main landing page for the "Ultimate Classroom" application.
 * It includes a hero section with actions to start or join a session, a feature
 * carousel, a grid of features, an "About Us" section, and a footer.
 * It uses `framer-motion` for animations and `react-router-dom` for navigation.
 */

// --- React and Library Imports ---
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';

// --- Asset Imports ---
import backgroundImage from './bg.jpeg'; 

// --- Icon Imports ---
// Icons used for UI elements and feature descriptions
import { 
  AcademicCapIcon,        // Used for the logo
  UsersIcon,              // Used for the "Join" button
  VideoCameraIcon,        // Used for the "Start" button and a feature
  ShareIcon,              // Feature icon
  ChatBubbleLeftRightIcon,    // Feature icon
  CpuChipIcon,              // Feature icon
  DevicePhoneMobileIcon,  // Feature icon
   ShieldCheckIcon       // Feature icon
} from '@heroicons/react/24/outline';
// Note: Removed unused SunIcon and MoonIcon imports.

/**
 * The main Home component for the landing page.
 */
function Home() {
  const navigate = useNavigate();
  
  // --- State Management ---
  
  // State for controlling the visibility of the "Join" and "Start" session forms (modals)
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [showStartForm, setShowStartForm] = useState(false);
  
  // State for storing user input from the forms
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState('');
  
  // State for the animated feature showcase in the hero section
  const [activeFeature, setActiveFeature] = useState(0); // Index of the currently displayed feature
  
  // State for the logo hover animation
  const [isLogoHovered, setIsLogoHovered] = useState(false);

  // Use the imported background image variable
  const backgroundImageUrl = backgroundImage; 
  
  // --- Data Definitions ---
  
  /**
   * Array of feature objects used for both the animated showcase
   * and the main features grid.
   */
  const features = [
    {
      icon: VideoCameraIcon,
      title: "HD Video Conferencing",
      description: "Crystal clear video quality with real-time streaming"
    },
    {
      icon: ShareIcon,
      title: "Screen Sharing",
      description: "Share your screen, presentations, and documents seamlessly"
    },
    {
      icon: ChatBubbleLeftRightIcon,
      title: "Interactive Chat",
      description: "Real-time messaging and Q&A sessions"
    },
    {
      icon: ShieldCheckIcon,
      title: "AI Monitoring",
      description: "Real-time AI monitoring to track engagement, detect anomalies, and maintain session quality."
    },
    {
      icon: DevicePhoneMobileIcon,
      title: "Cross-Platform",
      description: "Access from any device - desktop, tablet, or mobile"
    },
    {
      icon: CpuChipIcon,
      title: "AI Assistant",
      description: "On-demand chatbot help for teachers — quick answers, contextual guidance, and session support."
    }
  ];

  // --- Side Effects ---

  /**
   * `useEffect` hook to create an interval for the animated feature showcase.
   * It cycles through the `features` array every 3 seconds.
   */
  useEffect(() => {
    // Set up an interval to update the active feature
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length);
    }, 3000); // Change feature every 3 seconds
    
    // Cleanup function: clears the interval when the component unmounts
    return () => clearInterval(interval);
  }, [features.length]); // Dependency array ensures effect reruns only if features.length changes

  // --- Event Handlers ---

  /**
   * Handles the form submission for starting a new session.
   * Generates a new room ID, appends user's name and host status to
   * search parameters, and navigates to the new room.
   * @param {React.FormEvent} e - The form submission event.
   */
  const handleStart = (e) => {
    e.preventDefault(); // Prevent default form submission
    if (name) {
      const newRoomId = crypto.randomUUID(); // Generate a unique room ID
      const searchParams = new URLSearchParams();
      searchParams.append('name', name);
      searchParams.append('isHost', 'true'); // Mark this user as the host
      // Navigate to the room URL with query parameters
      navigate(`/room/${newRoomId}?${searchParams.toString()}`);
    }
  };

  /**
   * Handles the form submission for joining an existing session.
   * Appends user's name and host status (false) to search parameters
   * and navigates to the specified room ID.
   * @param {React.FormEvent} e - The form submission event.
   */
  const handleJoin = (e) => {
    e.preventDefault(); // Prevent default form submission
    if (roomId && name) {
      const searchParams = new URLSearchParams();
      searchParams.append('name', name);
      searchParams.append('isHost', 'false'); // Mark this user as a participant
      // Navigate to the room URL with query parameters
      navigate(`/room/${roomId}?${searchParams.toString()}`);
    }
  };

  /**
   * Closes any open modal (Start or Join) and resets the
   * form input fields to their default empty state.
   */
  const closeAllForms = () => {
    setShowJoinForm(false);
    setShowStartForm(false);
    setName('');
    setRoomId('');
  };

  // --- Derived State ---
  
  // Get the icon component for the currently active feature.
  // Defaults to VideoCameraIcon if features array is somehow empty.
  const CurrentFeatureIcon = features[activeFeature]?.icon || VideoCameraIcon;

  // --- Component-Render ---
  return (
    // 1. MAIN WRAPPER: Defines the overall scrollable area for the page.
    <div className="min-h-screen relative">
      
      {/* 2. BACKGROUND LAYER (Fixed) */}
      <div 
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${backgroundImageUrl}')` }}
      >
        {/* Blackish Overlay: Sits on top of the background image for readability */}
        <div className="absolute inset-0 bg-black/80 dark:bg-black/90" />
      </div>

      {/* 3. CONTENT WRAPPER: Sits above the background (z-10) */}
      <div className="relative z-10 min-h-screen">
        
        {/* --- Navigation Bar --- */}
        <nav className="px-6 py-4 flex justify-between items-center">
          {/* Logo Section */}
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center space-x-2"
          >
            <motion.div
              onHoverStart={() => setIsLogoHovered(true)}
              onHoverEnd={() => setIsLogoHovered(false)}
              animate={{ 
                scale: isLogoHovered ? 1.1 : 1,
                filter: isLogoHovered ? 'drop-shadow(0 0 20px rgba(96, 165, 250, 0.8))' : 'none'
              }}
              transition={{ duration: 0.3 }}
              className="relative"
            >
              <AcademicCapIcon className="h-8 w-8 text-blue-400" />
              {/* Animated glow effect on hover */}
              {isLogoHovered && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 bg-blue-400 rounded-full blur-md"
                />
              )}
            </motion.div>
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Ultimate Classroom
            </span>
          </motion.div>

          {/* Navigation Links */}
          <div className="flex items-center space-x-6">
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="hidden md:flex space-x-6"
            >
              <a href="#features" className="text-gray-300 hover:text-blue-400 transition-colors font-medium">Features</a>
              <a href="#about" className="text-gray-300 hover:text-blue-400 transition-colors font-medium">About Us</a>
            </motion.div>
          </div>
        </nav>

        {/* --- Hero Section --- */}
        <div className="isolate px-6 pt-10 lg:px-8">
          <div className="mx-auto max-w-4xl py-20 sm:py-28 lg:py-36">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-center"
            >
              {/* Main Headline */}
              <motion.h1
                className="text-5xl md:text-7xl font-bold tracking-tight"
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Ultimate Classroom
                </span>
              </motion.h1>
              
              {/* Sub-headline */}
              <motion.p
                className="mt-6 text-xl leading-8 text-gray-300"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                Revolutionizing virtual education with cutting-edge technology and seamless collaboration
              </motion.p>

              {/* Animated Feature Showcase */}
              <motion.div 
                key={activeFeature} // Use key to re-trigger animation on change
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-8 inline-flex items-center space-x-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 border border-gray-700"
              >
                <CurrentFeatureIcon className="h-5 w-5 text-blue-400" />
                <span className="text-sm font-medium text-gray-300">
                  {features[activeFeature]?.title}
                </span>
              </motion.div>
              
              {/* --- Call to Action Buttons --- */}
              <motion.div
                className="mt-12 flex flex-col items-center justify-center gap-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  {/* Start Session Button */}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setShowStartForm(true)} // Opens the modal
                    className="group relative inline-flex items-center gap-x-3 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 px-8 py-4 text-lg font-semibold text-white shadow-lg hover:shadow-xl transition-all duration-300"
                  >
                    <VideoCameraIcon className="h-5 w-5" />
                    Start New Session
                    {/* Animated "live" ping */}
                    <span className="absolute -top-2 -right-2 h-4 w-4 rounded-full bg-red-500 animate-ping" />
                  </motion.button>
                  
                  {/* Join Session Button */}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setShowJoinForm(true)} // Opens the modal
                    className="inline-flex items-center gap-x-3 rounded-2xl bg-white/10 backdrop-blur-sm px-8 py-4 text-lg font-semibold text-white shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-600"
                  >
                    <UsersIcon className="h-5 w-5" />
                    Join Session
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>

        {/* --- Modal Popup for Start/Join Session --- */}
        {/* This section renders conditionally based on showStartForm or showJoinForm */}
        {(showStartForm || showJoinForm) && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md"
            >
              {/* The form handles both "Start" and "Join" logic */}
              <form
                className="space-y-4 bg-gray-900 p-8 rounded-2xl shadow-xl border border-gray-700"
                onSubmit={showStartForm ? handleStart : handleJoin} // Selects handler based on state
              >
                <h3 className="text-2xl font-bold text-white mb-4">
                  {showStartForm ? 'Start New Session' : 'Join Session'}
                </h3>
                
                {/* Room ID input: Only shown for "Join Session" */}
                {showJoinForm && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Room ID
                    </label>
                    <input
                      type="text"
                      placeholder="Enter Room ID"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      required
                    />
                  </div>
                )}
                
                {/* Name input: Shown for both forms */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Your Name
                  </label>
                  <input
                    type="text"
                    placeholder="Enter your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    required
                  />
                </div>
                
                {/* Form Action Buttons */}
                <div className="flex gap-3 pt-4">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 rounded-xl font-semibold text-white transition-all"
                  >
                    {showStartForm ? 'Start Session' : 'Join Session'}
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button" // Important: type="button" to prevent form submission
                    onClick={closeAllForms}
                    className="px-6 py-3 bg-gray-600 hover:bg-gray-700 rounded-xl font-semibold text-white transition-all"
                  >
                    Cancel
                  </motion.button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {/* --- Features Section --- */}
        <section id="features" className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            {/* Section Header */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }} // Animate when it enters the viewport
              viewport={{ once: true }} // Only animate once
              className="text-center mb-16"
            >
              <h2 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Powerful Features
              </h2>
              <p className="mt-4 text-lg text-gray-300 max-w-2xl mx-auto">
                Everything you need for an exceptional virtual learning experience
              </p>
            </motion.div>

            {/* Features Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* Map over the features array to create a card for each */}
              {features.map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }} // Staggered animation
                  viewport={{ once: true }}
                  whileHover={{ scale: 1.05 }} // Scale up on hover
                  className="bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-gray-700 hover:shadow-2xl transition-all duration-300"
                >
                  <div className="p-3 bg-blue-900/50 rounded-xl w-fit mb-4">
                    <feature.icon className="h-6 w-6 text-blue-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-gray-300">
                    {feature.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* --- About Us Section --- */}
        <section id="about" className="py-20 px-6 bg-white/5 backdrop-blur-sm border-y border-gray-800">
          <div className="max-w-4xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-6">
                About Ultimate Classroom
              </h2>
              <p className="text-lg text-gray-300 leading-relaxed">
                Ultimate Classroom is a cutting-edge virtual learning platform designed to bridge the gap 
                between educators and students. Our mission is to make online education engaging, interactive, 
                and accessible to everyone. With state-of-the-art technology and user-friendly features, 
                we're transforming the way knowledge is shared and acquired in the digital age.
              </p>
            </motion.div>
          </div>
        </section>

        {/* --- Footer --- */}
        <footer className="py-8 px-6">
          <div className="max-w-6xl mx-auto text-center">
            <p className="text-sm text-gray-500 mt-2">
              © 2026 Karypto Inc. All rights reserved.
            </p>
          </div>
        </footer>

      </div> {/* End of Content Wrapper (z-10) */}
    </div> // End of Main Wrapper
  );
}

export default Home;