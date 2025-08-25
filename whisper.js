// whisper.js - Whisper.cpp integration for Performa Tracker

console.log('Whisper.js loaded');

const WHISPER_LIB_URL = 'https://cdn.jsdelivr.net/npm/whisper.cpp@1.0.3/whisper.js';
const WHISPER_WORKER_URL = 'https://cdn.jsdelivr.net/npm/whisper.cpp@1.0.3/libwhisper.worker.js';
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin';

let whisper;
let isRecording = false;
let audioContext;
let mediaRecorder;
let audioChunks = [];

async function initializeWhisper() {
  try {
    if (typeof Whisper === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = WHISPER_LIB_URL;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    whisper = new Whisper({
      workerUrl: WHISPER_WORKER_URL,
      modelUrl: WHISPER_MODEL_URL,
      onProgress: (progress) => {
        updateVoiceStatus(`Loading model: ${Math.round(progress * 100)}%`, 'loading');
      },
    });

    await whisper.init();
    updateVoiceStatus('Whisper ready', 'ready');
  } catch (error) {
    console.error('Error initializing Whisper:', error);
    updateVoiceStatus('Whisper failed to load', 'error');
  }
}

async function startWhisperRecognition() {
  if (!whisper) {
    await initializeWhisper();
  }

  if (isRecording) {
    stopWhisperRecognition();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
      audioChunks = [];
      updateVoiceStatus('Transcribing...', 'listening');

      try {
        const text = await whisper.transcribe(audioBlob);
        if (text) {
          addVoiceMessage('user', text);
          processCommand(text);
        }
        updateVoiceStatus('Whisper ready', 'ready');
      } catch (error) {
        console.error('Error transcribing audio:', error);
        updateVoiceStatus('Transcription failed', 'error');
      }
    };

    mediaRecorder.start();
    isRecording = true;
    updateVoiceStatus('Listening...', 'listening');
  } catch (error) {
    console.error('Error starting voice recognition:', error);
    updateVoiceStatus('Mic access denied', 'error');
  }
}

function stopWhisperRecognition() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
  }
}

function processCommand(transcript) {
  const commands = getVoiceCommands();
  transcript = transcript.toLowerCase();

  if (transcript.includes(commands.startTimer)) {
    startTimer();
    speakFeedback(commands.startTimerFeedback, 'startTimer');
  } else if (transcript.includes(commands.stopTimer)) {
    stopTimer();
    speakFeedback(commands.stopTimerFeedback, 'stopTimer');
  } else if (transcript.includes(commands.resetTimer)) {
    resetTimer();
    speakFeedback(commands.resetTimerFeedback);
  } else if (transcript.includes(commands.startJog)) {
    startJogging();
    speakFeedback(commands.startJogFeedback);
  } else if (transcript.includes(commands.stopJog)) {
    stopJogging();
    speakFeedback(commands.stopJogFeedback);
  } else if (transcript.includes(commands.logExercise)) {
    const exerciseName = transcript.split(commands.logExercise)[1].trim();
    handleSmartExerciseLogging(exerciseName);
  } else if (transcript.includes(commands.startTimerFor)) {
    const timeText = transcript.split(commands.startTimerFor)[1].trim();
    handleTimerForDuration(timeText);
  } else if (transcript.includes(commands.addEntry)) {
    const addBtn = document.getElementById('addEntry');
    if (addBtn) {
      addBtn.click();
      speakFeedback(commands.addEntryFeedback, 'addEntry');
    }
  } else if (transcript.includes(commands.setActualReps)) {
    const repsValue = transcript.split(commands.setActualReps)[1].trim();
    const type = document.getElementById('type').value;
    let repsField;
    if (type === 'reps') {
      repsField = document.getElementById('actualValue');
    } else if (type === 'semi') {
      repsField = document.getElementById('reps');
    }

    if (repsField) {
      repsField.value = repsValue;
      speakFeedback(`${commands.setActualRepsFeedback} ${repsValue}`);
    }
  } else if (transcript.includes(commands.showProgress)) {
    showProgressView();
    speakFeedback(`${commands.navigationFeedback} progress view`);
  } else if (transcript.includes(commands.showArchive)) {
    showArchiveView();
    speakFeedback(`${commands.navigationFeedback} archive view`);
  } else if (transcript.includes(commands.openSettings)) {
    showSettingsView();
    speakFeedback(`${commands.navigationFeedback} settings`);
  } else if (transcript.includes(commands.goHome)) {
    hideAllViews();
    speakFeedback(`${commands.navigationFeedback} home`);
  } else {
    // Check complex tasks
    let commandFound = false;
    for (const task of complexTasks) {
      const matchingCommand = task.commands ?
        task.commands.find(cmd => transcript.includes(cmd.toLowerCase())) :
        (transcript.includes(task.command ? task.command.toLowerCase() : task.primaryCommand));

      if (matchingCommand) {
        executeComplexTask(task);
        commandFound = true;
        break;
      }
    }

    // Check automation sequences
    if (!commandFound) {
      for (const automation of automationSequences) {
        const matchingCommand = automation.commands ?
          automation.commands.find(cmd => transcript.includes(cmd.toLowerCase())) :
          (transcript.includes(automation.command ? automation.command.toLowerCase() : automation.name.toLowerCase()));

        if (matchingCommand) {
          executeAutomationSequence(automation);
          commandFound = true;
          break;
        }
      }
    }

    if (!commandFound) {
      speakFeedback("Command not recognized. Please try again or check your voice settings.");
    }
  }
}

// Initialize whisper when the script is loaded
initializeWhisper();
