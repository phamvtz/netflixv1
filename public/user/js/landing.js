/* ── Particles ─────────────────────────────────────── */
(function initParticles() {
  const canvas = document.getElementById('particleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < 60; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.5 + .5,
      dx: (Math.random() - .5) * .4,
      dy: (Math.random() - .5) * .4,
      alpha: Math.random() * .5 + .1,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(229,9,20,${p.alpha})`;
      ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0 || p.x > W) p.dx *= -1;
      if (p.y < 0 || p.y > H) p.dy *= -1;
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ── Header scroll ─────────────────────────────────── */
window.addEventListener('scroll', () => {
  const h = document.getElementById('lndHeader');
  if (h) h.classList.toggle('scrolled', window.scrollY > 60);
}, { passive: true });

/* ── FAQ toggle ────────────────────────────────────── */
function toggleFaq(btn) {
  const item   = btn.closest('.lnd-faq-item');
  const answer = item.querySelector('.lnd-faq-a');
  const isOpen = answer.classList.contains('open');

  // Close all
  document.querySelectorAll('.lnd-faq-a.open').forEach(a => a.classList.remove('open'));
  document.querySelectorAll('.lnd-faq-q.open').forEach(b => b.classList.remove('open'));

  if (!isOpen) {
    answer.classList.add('open');
    btn.classList.add('open');
  }
}

/* ── Scroll reveal ─────────────────────────────────── */
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.style.opacity = '1';
      e.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: .15 });

document.querySelectorAll('.lnd-feature, .lnd-stats-bar, .lnd-faq').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(30px)';
  el.style.transition = 'opacity .6s ease, transform .6s ease';
  observer.observe(el);
});

/* ── Email prefill ─────────────────────────────────── */
document.getElementById('getStartedBtn')?.addEventListener('click', () => {
  const email = document.getElementById('heroEmail')?.value.trim();
  if (email) sessionStorage.setItem('prefillEmail', email);
});
