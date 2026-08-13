(() => {
  'use strict';

  const { api, ensureAuth, formatDate, normalizeText, setBusy, toast } = window.Vistos;
  const state = {
    snapshot: null,
    activeRound: null,
    scanner: null,
    scanning: false,
    processing: false,
    lastCode: '',
    lastCodeAt: 0,
    lastMarkId: '',
    resultTimer: null
  };

  const elements = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    Object.assign(elements, {
      roundTitle: document.getElementById('roundTitle'),
      roundMeta: document.getElementById('roundMeta'),
      newRoundButton: document.getElementById('newRoundButton'),
      closeRoundButton: document.getElementById('closeRoundButton'),
      cameraButton: document.getElementById('cameraButton'),
      manualButton: document.getElementById('manualButton'),
      scannerStage: document.getElementById('scannerStage'),
      roundDialog: document.getElementById('roundDialog'),
      roundForm: document.getElementById('roundForm'),
      roundClass: document.getElementById('roundClass'),
      roundName: document.getElementById('roundName'),
      manualDialog: document.getElementById('manualDialog'),
      manualSearch: document.getElementById('manualSearch'),
      manualStudents: document.getElementById('manualStudents'),
      recentList: document.getElementById('recentList'),
      recentEmpty: document.getElementById('recentEmpty'),
      resultSheet: document.getElementById('resultSheet'),
      resultIcon: document.getElementById('resultIcon'),
      resultTitle: document.getElementById('resultTitle'),
      resultMeta: document.getElementById('resultMeta'),
      undoButton: document.getElementById('undoButton')
    });

    bindEvents();
    try {
      await ensureAuth();
      await loadSnapshot();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function bindEvents() {
    elements.newRoundButton.addEventListener('click', openRoundDialog);
    elements.roundForm.addEventListener('submit', createRound);
    elements.closeRoundButton.addEventListener('click', closeRound);
    elements.cameraButton.addEventListener('click', toggleCamera);
    elements.manualButton.addEventListener('click', openManualDialog);
    elements.manualSearch.addEventListener('input', renderManualStudents);
    elements.undoButton.addEventListener('click', undoLastMark);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.scanning) stopCamera();
    });
  }

  async function loadSnapshot() {
    state.snapshot = await api.request('snapshot');
    state.activeRound = state.snapshot.activeRound;
    renderRound();
    renderRecent();
  }

  function renderRound() {
    const round = state.activeRound;
    if (!round) {
      elements.roundTitle.textContent = 'Nenhuma atividade aberta';
      elements.roundMeta.textContent = 'Crie uma atividade antes de ler os QR codes.';
      elements.cameraButton.disabled = true;
      elements.manualButton.disabled = true;
      elements.closeRoundButton.classList.add('hidden');
      return;
    }

    elements.roundTitle.textContent = round.title;
    elements.roundMeta.textContent = `${round.className} · Atividade ${round.number} · ${round.marksCount} visto${round.marksCount === 1 ? '' : 's'}`;
    elements.cameraButton.disabled = false;
    elements.manualButton.disabled = false;
    elements.closeRoundButton.classList.remove('hidden');
  }

  function openRoundDialog() {
    elements.roundClass.replaceChildren();
    state.snapshot.classes.forEach((className) => {
      const option = document.createElement('option');
      option.value = className;
      option.textContent = className;
      if (state.activeRound && state.activeRound.className === className) option.selected = true;
      elements.roundClass.appendChild(option);
    });
    elements.roundName.value = '';
    elements.roundDialog.showModal();
    window.setTimeout(() => elements.roundName.focus(), 100);
  }

  async function createRound(event) {
    event.preventDefault();
    const button = elements.roundForm.querySelector('button[type="submit"]');
    setBusy(button, true, 'Criando…');
    try {
      if (state.scanning) await stopCamera();
      state.activeRound = await api.request('createRound', {
        turma: elements.roundClass.value,
        title: elements.roundName.value.trim()
      });
      state.snapshot.activeRound = state.activeRound;
      elements.roundDialog.close();
      renderRound();
      toast('Atividade criada. A câmera está pronta.', 'success');
      await startCamera();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function closeRound() {
    if (!state.activeRound || !confirm(`Encerrar “${state.activeRound.title}”?`)) return;
    setBusy(elements.closeRoundButton, true, 'Encerrando…');
    try {
      if (state.scanning) await stopCamera();
      await api.request('closeRound', { roundId: state.activeRound.id });
      state.activeRound = null;
      state.snapshot.activeRound = null;
      renderRound();
      toast('Atividade encerrada.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(elements.closeRoundButton, false);
    }
  }

  async function toggleCamera() {
    if (state.scanning) await stopCamera();
    else await startCamera();
  }

  async function startCamera() {
    if (!state.activeRound || state.scanning) return;
    if (!window.Html5Qrcode) {
      toast('O leitor de QR não foi carregado. Atualize a página.', 'error');
      return;
    }

    setBusy(elements.cameraButton, true, 'Abrindo câmera…');
    try {
      state.scanner = state.scanner || new Html5Qrcode('reader', {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false
      });
      await state.scanner.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: (width, height) => {
            const size = Math.floor(Math.min(width, height) * 0.66);
            return { width: size, height: size };
          },
          aspectRatio: 1
        },
        onQrCode,
        () => {}
      );
      state.scanning = true;
      elements.scannerStage.classList.add('is-scanning');
      elements.cameraButton.querySelector('span').textContent = 'Parar câmera';
    } catch (error) {
      const message = String(error).includes('Permission') || String(error).includes('NotAllowed')
        ? 'Permita o uso da câmera nas configurações do navegador.'
        : 'Não foi possível abrir a câmera. Use a busca manual.';
      toast(message, 'error');
    } finally {
      setBusy(elements.cameraButton, false);
    }
  }

  async function stopCamera() {
    if (!state.scanner || !state.scanning) return;
    try {
      await state.scanner.stop();
      await state.scanner.clear();
    } catch (_) {
      // A interface ainda deve voltar ao estado parado.
    }
    state.scanning = false;
    elements.scannerStage.classList.remove('is-scanning');
    elements.cameraButton.querySelector('span').textContent = 'Iniciar câmera';
  }

  async function onQrCode(decodedText) {
    const now = Date.now();
    if (state.processing || (decodedText === state.lastCode && now - state.lastCodeAt < 3500)) return;
    state.lastCode = decodedText;
    state.lastCodeAt = now;
    await register({ qr: decodedText });
  }

  async function register(identity) {
    if (!state.activeRound || state.processing) return;
    state.processing = true;
    if (state.scanning) {
      try { state.scanner.pause(true); } catch (_) {}
    }

    try {
      const result = await api.request('registerMark', {
        roundId: state.activeRound.id,
        qr: identity.qr,
        ra: identity.ra,
        device: `${navigator.platform || 'Android'} · Web`
      });

      state.activeRound.marksCount = result.roundMarks;
      renderRound();
      if (result.duplicate) {
        showResult('warning', '!', result.student.name, 'Visto já lançado nesta atividade', '');
        feedback('warning');
      } else {
        state.lastMarkId = result.markId;
        showResult('success', '✓', result.student.name, `${result.student.className} · Visto ${result.roundMarks}`, result.markId);
        prependRecent(result);
        feedback('success');
      }
      if (elements.manualDialog.open) elements.manualDialog.close();
    } catch (error) {
      showResult('error', '×', 'Não registrado', error.message, '');
      feedback('error');
      if (error.code === 'ROUND_CLOSED') {
        state.activeRound = null;
        renderRound();
      }
    } finally {
      window.setTimeout(() => {
        state.processing = false;
        if (state.scanning) {
          try { state.scanner.resume(); } catch (_) {}
        }
      }, 1050);
    }
  }

  function showResult(type, icon, title, meta, markId) {
    window.clearTimeout(state.resultTimer);
    elements.resultSheet.className = `result-sheet show ${type === 'success' ? '' : type}`.trim();
    elements.resultSheet.setAttribute('aria-hidden', 'false');
    elements.resultIcon.textContent = icon;
    elements.resultTitle.textContent = title;
    elements.resultMeta.textContent = meta;
    elements.undoButton.classList.toggle('hidden', !markId);
    elements.undoButton.dataset.markId = markId || '';
    state.resultTimer = window.setTimeout(hideResult, 5200);
  }

  function hideResult() {
    elements.resultSheet.classList.remove('show');
    elements.resultSheet.setAttribute('aria-hidden', 'true');
  }

  function feedback(type) {
    if (navigator.vibrate) navigator.vibrate(type === 'success' ? 70 : [80, 55, 80]);
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = type === 'success' ? 880 : 220;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.13);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.14);
    } catch (_) {}
  }

  async function undoLastMark() {
    const markId = elements.undoButton.dataset.markId;
    if (!markId) return;
    setBusy(elements.undoButton, true, 'Desfazendo…');
    try {
      await api.request('undoMark', { markId });
      state.activeRound.marksCount = Math.max(0, state.activeRound.marksCount - 1);
      renderRound();
      const recent = elements.recentList.querySelector(`[data-mark-id="${CSS.escape(markId)}"]`);
      if (recent) recent.remove();
      elements.recentEmpty.classList.toggle('hidden', elements.recentList.children.length > 0);
      hideResult();
      toast('Visto removido.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(elements.undoButton, false);
    }
  }

  function openManualDialog() {
    elements.manualSearch.value = '';
    renderManualStudents();
    elements.manualDialog.showModal();
    window.setTimeout(() => elements.manualSearch.focus(), 100);
  }

  function renderManualStudents() {
    if (!state.activeRound) return;
    const query = normalizeText(elements.manualSearch.value);
    const students = state.snapshot.students
      .filter((student) => student.className === state.activeRound.className && normalizeText(student.name).includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    elements.manualStudents.replaceChildren();
    students.forEach((student) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'student-choice';
      const copy = document.createElement('span');
      const name = document.createElement('strong');
      const meta = document.createElement('span');
      const arrow = document.createElement('i');
      name.textContent = student.name;
      meta.textContent = `${student.className} · RA ${student.ra}`;
      arrow.textContent = '+';
      copy.append(name, meta);
      button.append(copy, arrow);
      button.addEventListener('click', () => register({ ra: student.ra }));
      elements.manualStudents.appendChild(button);
    });
  }

  function renderRecent() {
    elements.recentList.replaceChildren();
    state.snapshot.recentMarks.forEach((mark) => elements.recentList.appendChild(createRecentItem({
      markId: mark.id,
      student: mark.student,
      registeredAt: mark.registeredAt,
      round: mark.round
    })));
    elements.recentEmpty.classList.toggle('hidden', state.snapshot.recentMarks.length > 0);
  }

  function prependRecent(result) {
    elements.recentEmpty.classList.add('hidden');
    elements.recentList.prepend(createRecentItem(result));
    while (elements.recentList.children.length > 12) elements.recentList.lastElementChild.remove();
  }

  function createRecentItem(item) {
    const row = document.createElement('li');
    row.className = 'recent-item';
    row.dataset.markId = item.markId;
    const check = document.createElement('span');
    check.className = 'recent-check';
    check.textContent = '✓';
    const copy = document.createElement('div');
    copy.className = 'recent-copy';
    const name = document.createElement('strong');
    const meta = document.createElement('span');
    name.textContent = item.student.name;
    meta.textContent = `${item.student.className}${item.round ? ` · ${item.round.title}` : ''}`;
    copy.append(name, meta);
    const time = document.createElement('time');
    time.className = 'recent-time';
    time.textContent = formatDate(item.registeredAt, { hour: '2-digit', minute: '2-digit' });
    row.append(check, copy, time);
    return row;
  }
})();
