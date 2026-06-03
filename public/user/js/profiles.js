(async () => {
  try {
    const res  = await fetch('/api/profiles');
    const data = await res.json();
    if (!data.success) { window.location.href = '/login'; return; }

    const grid = document.getElementById('profilesGrid');
    data.profiles.forEach(profile => {
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.innerHTML = `
        <div class="profile-avatar" style="background:${profile.color}">${profile.initial}</div>
        <span class="profile-name">${profile.name}</span>
      `;
      card.addEventListener('click', () => selectProfile(profile));
      grid.appendChild(card);
    });
  } catch {
    window.location.href = '/login';
  }
})();

async function selectProfile(profile) {
  try {
    const res  = await fetch('/api/profiles/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: profile.id }),
    });
    const data = await res.json();
    if (data.success) {
      // Store selected profile info for the browse page
      sessionStorage.setItem('activeProfile', JSON.stringify(profile));
      window.location.href = data.redirect || '/browse';
    }
  } catch {
    console.error('Failed to select profile');
  }
}
