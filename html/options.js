let timeout = null;

const saveOptions = () => {
  const sortby = document.getElementById('sortby').value;
  const sortdir = document.getElementById('sortdir').value;
  const showbuttons = document.getElementById('show-buttons').checked;
  
  const savednotes = document.getElementById('saved-notes').checked;
  const classlinks = document.getElementById('class-links').checked;

  chrome.storage.sync.set(
    {
        sortby: sortby,
        sortdir: sortdir,
        savednotes: savednotes,
        classlinks: classlinks,
        showbuttons: showbuttons,
    },
    () => {
      // Update status to let user know options were saved.
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        status.textContent = '';
      }, 750);
    }
  );
};

// Restores select box and checkbox state using the preferences
const restoreOptions = () => {
  chrome.storage.sync.get(
    { sortby: 'none', sortdir: 'asc', savednotes: true, classlinks: true, showbuttons: true, },
    (items) => {
        // Assignement Center
        document.getElementById('sortby').value = items.sortby;
        if(items.sortby != 'none') document.getElementById('ac-sortdir').style = '';

        document.getElementById('sortdir').value = items.sortdir;

        document.getElementById('show-buttons').checked = items.showbuttons;
        
        // Assignement Page
        document.getElementById('saved-notes').checked = items.savednotes;
        document.getElementById('class-links').checked = items.classlinks;
    }
  );
};

const showSortDir = () => {
    const sortby = document.getElementById('sortby').value;
    const sortdir = document.getElementById('ac-sortdir');

    if (sortby === 'none') sortdir.style = 'display: none;';
    else sortdir.style = '';
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('sortby').addEventListener('change', showSortDir);
document.getElementById('save').addEventListener('click', saveOptions);
document.querySelectorAll("input[type='checkbox']").forEach((el) => {
    el.addEventListener("click", (e) => e.stopPropagation());
    el.parentElement.addEventListener("click", (e) => el.checked = !el.checked);
});