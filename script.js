const demoButton = document.getElementById('demoButton');

if (demoButton) {
  demoButton.addEventListener('click', () => {
    window.location.href = 'upload.html?demo=1';
  });
}
