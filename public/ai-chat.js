/* ═══════════════════════════════════════════════════════════
   AI Chat — Slide-out panel & conversational AI
   ═══════════════════════════════════════════════════════════ */

const AIChat = (() => {
  let chatHistory = [];
  let isLoading = false;
  let currentAttachment = null;

  function getApiKey() {
    return localStorage.getItem('stockpulse_gemini_key') || '';
  }

  function getMessages() {
    return document.getElementById('chat-messages');
  }

  // ─── Render a message ───
  function addMessage(role, content, attachment = null) {
    const container = getMessages();
    if (!container) return;

    const msg = document.createElement('div');
    msg.className = `chat-msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    
    let html = '';
    if (attachment) {
      if (attachment.isText) {
        html += `<div class="msg-attachment-doc">📄 ${attachment.name}</div>`;
      } else if (attachment.mimeType && attachment.mimeType.startsWith('image/')) {
        html += `<div class="msg-attachment"><img src="${attachment.dataUrl}" alt="Attached image"></div>`;
      } else {
        html += `<div class="msg-attachment-doc">📎 ${attachment.name}</div>`;
      }
    }
    
    html += formatMessage(content);
    bubble.innerHTML = html;

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    container.appendChild(msg);

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  // ─── Format message (basic markdown-like) ───
  function formatMessage(text) {
    if (!text) return '<p>No response received.</p>';

    // Escape HTML
    let formatted = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Bold
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Italic
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Inline code
    formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');

    // Headers
    formatted = formatted.replace(/^### (.*?)$/gm, '<h4>$1</h4>');
    formatted = formatted.replace(/^## (.*?)$/gm, '<h3>$1</h3>');

    // Bullet points
    formatted = formatted.replace(/^\* (.*?)$/gm, '• $1');
    formatted = formatted.replace(/^- (.*?)$/gm, '• $1');

    // Numbered lists
    formatted = formatted.replace(/^\d+\. (.*?)$/gm, '$&');

    // Paragraphs
    formatted = formatted
      .split('\n\n')
      .map(para => {
        para = para.trim();
        if (!para) return '';
        if (para.startsWith('<h') || para.startsWith('<ul') || para.startsWith('<ol')) return para;
        return `<p>${para.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');

    return formatted || `<p>${text}</p>`;
  }

  // ─── Show typing indicator ───
  function showTyping() {
    const container = getMessages();
    if (!container) return;

    const msg = document.createElement('div');
    msg.className = 'chat-msg assistant';
    msg.id = 'typing-msg';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = '🤖';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('typing-msg');
    if (el) el.remove();
  }

  // ─── Send message ───
  async function sendMessage(text) {
    if ((!text.trim() && !currentAttachment) || isLoading) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      addMessage('assistant', '⚠️ **API Key Required**\n\nPlease add your Gemini API key in **Settings** before using the AI assistant.\n\nGet a free key from [Google AI Studio](https://aistudio.google.com/app/apikey).');
      return;
    }

    isLoading = true;
    const sendBtn = document.getElementById('chat-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    const attachmentToSend = currentAttachment;
    currentAttachment = null;
    if (window.renderFilePreview) window.renderFilePreview();

    // Add user message
    addMessage('user', text, attachmentToSend);
    chatHistory.push({ role: 'user', content: text });

    // Show typing
    showTyping();

    try {
      // Build context from current stock if available
      const context = window.StockPulseApp?.getCurrentStockContext?.() || '';

      const attachmentsPayload = attachmentToSend ? [attachmentToSend] : [];
      const response = await API.chat(text, context, chatHistory.slice(-10), apiKey, attachmentsPayload);

      hideTyping();
      addMessage('assistant', response.reply);
      chatHistory.push({ role: 'assistant', content: response.reply });

      // Save chat to localStorage
      saveChatHistory();
    } catch (err) {
      hideTyping();
      addMessage('assistant', `❌ **Error:** ${err.message}\n\nPlease check your API key in Settings and try again.`);
    }

    isLoading = false;
    if (sendBtn) sendBtn.disabled = false;

    // Focus back on input
    const input = document.getElementById('chat-input');
    if (input) input.focus();
  }

  // ─── Save/Load chat history ───
  function saveChatHistory() {
    try {
      localStorage.setItem('stockpulse_chat_history', JSON.stringify(chatHistory.slice(-50)));
    } catch (e) { /* quota exceeded, ignore */ }
  }

  function loadChatHistory() {
    try {
      const saved = localStorage.getItem('stockpulse_chat_history');
      if (saved) {
        chatHistory = JSON.parse(saved);
        // Re-render messages
        chatHistory.forEach(msg => addMessage(msg.role, msg.content));
      }
    } catch (e) { /* corrupt data, ignore */ }
  }

  function clearChat() {
    chatHistory = [];
    localStorage.removeItem('stockpulse_chat_history');
    const container = getMessages();
    if (container) {
      // Keep the welcome message
      container.innerHTML = `
        <div class="chat-msg assistant">
          <div class="msg-avatar">🤖</div>
          <div class="msg-bubble">
            <p>Namaste! I'm <strong>StockPulse AI</strong>, your assistant for Indian stock market analysis. How can I help you today?</p>
          </div>
        </div>
      `;
    }
  }

  // ─── Init ───
  function init() {
    loadChatHistory();

    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send-btn');
    const fileInput = document.getElementById('chat-file-input');
    const previewContainer = document.getElementById('chat-file-preview');

    // File Preview Renderer
    window.renderFilePreview = () => {
      if (!currentAttachment) {
        if (previewContainer) {
          previewContainer.innerHTML = '';
          previewContainer.classList.add('hidden');
        }
        if (fileInput) fileInput.value = '';
        return;
      }

      if (previewContainer) {
        previewContainer.classList.remove('hidden');
        const isImage = currentAttachment.mimeType && currentAttachment.mimeType.startsWith('image/');
        const iconHtml = isImage ? `<img src="${currentAttachment.dataUrl}" alt="Preview">` : `<span>📄</span>`;
        
        previewContainer.innerHTML = `
          <div class="chat-file-chip">
            ${iconHtml}
            <span>${currentAttachment.name}</span>
            <span class="chat-file-remove" onclick="window.removeChatAttachment()">×</span>
          </div>
        `;
      }
    };

    window.removeChatAttachment = () => {
      currentAttachment = null;
      window.renderFilePreview();
    };

    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        
        if (file.type.startsWith('text/') || file.name.endsWith('.csv') || file.name.endsWith('.md')) {
           reader.readAsText(file);
           reader.onload = () => {
             currentAttachment = {
               name: file.name,
               mimeType: file.type || 'text/plain',
               data: reader.result,
               isText: true
             };
             window.renderFilePreview();
           };
        } else {
           reader.readAsDataURL(file);
           reader.onload = () => {
             const base64Str = reader.result.split(',')[1];
             currentAttachment = {
               name: file.name,
               mimeType: file.type,
               data: base64Str,
               dataUrl: reader.result,
               isText: false
             };
             window.renderFilePreview();
           };
        }
      });
    }

    // Chat input handlers
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(input.value);
          input.value = '';
        }
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        if (input) {
          sendMessage(input.value);
          input.value = '';
        }
      });
    }

    // Quick prompts
    document.querySelectorAll('.prompt-chip[data-prompt]').forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt;
        if (input) input.value = prompt;
        sendMessage(prompt);
        if (input) input.value = '';
      });
    });

    // Clear chat
    const clearBtn = document.getElementById('btn-clear-chat');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearChat);
    }
  }

  return { init, sendMessage, clearChat };
})();
