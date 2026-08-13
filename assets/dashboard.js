(() => {
  'use strict';

  const { api, ensureAuth, formatDate, logout, normalizeText, setBusy, sha256, toast } = window.Vistos;
  const state = { data: null, visibleStudents: [] };
  const elements = {};

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    Object.assign(elements, {
      refreshButton: document.getElementById('refreshButton'),
      updatedAt: document.getElementById('updatedAt'),
      activeBanner: document.getElementById('activeBanner'),
      activeBannerTitle: document.getElementById('activeBannerTitle'),
      activeBannerMeta: document.getElementById('activeBannerMeta'),
      metricStudents: document.getElementById('metricStudents'),
      metricRounds: document.getElementById('metricRounds'),
      metricAverage: document.getElementById('metricAverage'),
      metricToday: document.getElementById('metricToday'),
      classFilter: document.getElementById('classFilter'),
      studentSearch: document.getElementById('studentSearch'),
      tableBody: document.getElementById('studentTableBody'),
      empty: document.getElementById('dashboardEmpty'),
      exportButton: document.getElementById('exportButton'),
      studentDialog: document.getElementById('studentDialog'),
      studentDetailClass: document.getElementById('studentDetailClass'),
      studentDetailName: document.getElementById('studentDetailName'),
      studentHistory: document.getElementById('studentHistory'),
      accountButton: document.getElementById('accountButton'),
      accountDialog: document.getElementById('accountDialog'),
      changePinButton: document.getElementById('changePinButton'),
      logoutButton: document.getElementById('logoutButton'),
      pinDialog: document.getElementById('pinDialog'),
      pinForm: document.getElementById('pinForm'),
      newPin: document.getElementById('newPin'),
      confirmPin: document.getElementById('confirmPin'),
      pinError: document.getElementById('pinError')
    });

    bindEvents();
    try {
      await ensureAuth();
      await loadDashboard();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function bindEvents() {
    elements.refreshButton.addEventListener('click', loadDashboard);
    elements.classFilter.addEventListener('change', loadDashboard);
    elements.studentSearch.addEventListener('input', renderStudents);
    elements.exportButton.addEventListener('click', exportCsv);
    elements.accountButton.addEventListener('click', () => elements.accountDialog.showModal());
    elements.logoutButton.addEventListener('click', logout);
    elements.changePinButton.addEventListener('click', () => {
      elements.accountDialog.close();
      elements.pinForm.reset();
      elements.pinError.textContent = '';
      elements.pinDialog.showModal();
      window.setTimeout(() => elements.newPin.focus(), 100);
    });
    elements.pinForm.addEventListener('submit', changePin);
  }

  async function loadDashboard() {
    setBusy(elements.refreshButton, true);
    try {
      state.data = await api.request('dashboard', { turma: elements.classFilter.value });
      populateClassFilter();
      renderSummary();
      renderStudents();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(elements.refreshButton, false);
    }
  }

  function populateClassFilter() {
    const selected = state.data.selectedClass;
    elements.classFilter.replaceChildren();
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'Todas';
    elements.classFilter.appendChild(all);
    state.data.classes.forEach((className) => {
      const option = document.createElement('option');
      option.value = className;
      option.textContent = className;
      option.selected = className === selected;
      elements.classFilter.appendChild(option);
    });
  }

  function renderSummary() {
    const { summary, activeRound } = state.data;
    elements.metricStudents.textContent = summary.students;
    elements.metricRounds.textContent = summary.rounds;
    elements.metricAverage.textContent = summary.averageGrade === null ? '—' : summary.averageGrade.toFixed(1).replace('.', ',');
    elements.metricToday.textContent = summary.todayMarks;
    elements.updatedAt.textContent = `Atualizado em ${formatDate(state.data.generatedAt)}`;

    elements.activeBanner.classList.toggle('hidden', !activeRound);
    if (activeRound) {
      elements.activeBannerTitle.textContent = activeRound.title;
      elements.activeBannerMeta.textContent = `${activeRound.className} · ${activeRound.marksCount} visto${activeRound.marksCount === 1 ? '' : 's'} · em andamento`;
    }
  }

  function renderStudents() {
    if (!state.data) return;
    const query = normalizeText(elements.studentSearch.value);
    state.visibleStudents = state.data.students.filter((student) => normalizeText(student.name).includes(query));
    elements.tableBody.replaceChildren();

    state.visibleStudents.forEach((student) => {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      const nameButton = document.createElement('button');
      nameButton.type = 'button';
      nameButton.className = 'student-name-button';
      nameButton.textContent = student.name;
      nameButton.addEventListener('click', () => showStudent(student));
      nameCell.appendChild(nameButton);

      const classCell = document.createElement('td');
      const classPill = document.createElement('span');
      classPill.className = 'class-pill';
      classPill.textContent = student.className;
      classCell.appendChild(classPill);

      const progressCell = document.createElement('td');
      progressCell.className = 'progress-cell';
      const track = document.createElement('div');
      track.className = 'progress-track';
      const bar = document.createElement('i');
      bar.style.setProperty('--progress', `${Math.min(100, student.percentage)}%`);
      track.appendChild(bar);
      const percentage = document.createElement('small');
      percentage.textContent = student.expected ? `${student.percentage}% concluído` : 'Sem atividades';
      progressCell.append(track, percentage);

      const marksCell = document.createElement('td');
      marksCell.textContent = `${student.received} / ${student.expected}`;

      const gradeCell = document.createElement('td');
      const grade = document.createElement('span');
      grade.className = `grade${student.grade !== null && student.grade < 6 ? ' low' : ''}`;
      grade.textContent = student.grade === null ? '—' : student.grade.toFixed(1).replace('.', ',');
      gradeCell.appendChild(grade);

      row.append(nameCell, classCell, progressCell, marksCell, gradeCell);
      elements.tableBody.appendChild(row);
    });

    elements.empty.classList.toggle('hidden', state.visibleStudents.length > 0);
    elements.exportButton.disabled = state.visibleStudents.length === 0;
  }

  async function showStudent(student) {
    elements.studentDetailClass.textContent = `${student.className} · RA ${student.ra}`;
    elements.studentDetailName.textContent = student.name;
    elements.studentHistory.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'empty-state compact';
    loading.textContent = 'Carregando histórico…';
    elements.studentHistory.appendChild(loading);
    elements.studentDialog.showModal();

    try {
      const details = await api.request('studentDetails', { ra: student.ra });
      elements.studentHistory.replaceChildren();
      if (!details.history.length) {
        loading.textContent = 'Nenhuma atividade para esta turma.';
        elements.studentHistory.appendChild(loading);
        return;
      }
      details.history.forEach((item) => {
        const row = document.createElement('div');
        row.className = `history-item${item.received ? ' received' : ''}`;
        const status = document.createElement('span');
        status.className = 'history-status';
        status.textContent = item.received ? '✓' : '—';
        const copy = document.createElement('div');
        const title = document.createElement('strong');
        const meta = document.createElement('span');
        title.textContent = item.title;
        meta.textContent = `Atividade ${item.number} · ${item.received ? 'Visto recebido' : 'Sem visto'}`;
        copy.append(title, meta);
        row.append(status, copy);
        elements.studentHistory.appendChild(row);
      });
    } catch (error) {
      elements.studentHistory.replaceChildren(loading);
      loading.textContent = error.message;
    }
  }

  function exportCsv() {
    const header = ['RA', 'Aluno', 'Turma', 'Vistos recebidos', 'Atividades', 'Percentual', 'Nota'];
    const rows = state.visibleStudents.map((student) => [
      student.ra,
      student.name,
      student.className,
      student.received,
      student.expected,
      `${student.percentage}%`,
      student.grade === null ? '' : student.grade.toFixed(1).replace('.', ',')
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vistos-${elements.classFilter.value || 'todas-as-turmas'}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Planilha CSV exportada.', 'success');
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  async function changePin(event) {
    event.preventDefault();
    const button = elements.pinForm.querySelector('button[type="submit"]');
    const pin = elements.newPin.value;
    elements.pinError.textContent = '';

    if (!/^\d{6,12}$/.test(pin)) {
      elements.pinError.textContent = 'Use de 6 a 12 números.';
      return;
    }
    if (pin !== elements.confirmPin.value) {
      elements.pinError.textContent = 'Os dois PINs são diferentes.';
      return;
    }

    setBusy(button, true, 'Salvando…');
    try {
      await api.request('changePin', { newPinHash: await sha256(pin) });
      api.token = '';
      elements.pinDialog.close();
      alert('PIN alterado. Entre novamente com o novo PIN.');
      location.reload();
    } catch (error) {
      elements.pinError.textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }
})();
