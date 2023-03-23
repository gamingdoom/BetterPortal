// Saves options to chrome.storage
const saveOptions = () => {
  const sortby = document.getElementById('sortby').value;

  chrome.storage.sync.set(
    { sortby: sortby },
    () => {
      // Update status to let user know options were saved.
      const status = document.getElementById('status');
      status.textContent = 'Options saved.';
      setTimeout(() => {
        status.textContent = '';
      }, 750);
    }
  );
};

// Restores select box and checkbox state using the preferences
const restoreOptions = () => {
  chrome.storage.sync.get(
    { sortby: 'none' },
    (items) => {
      document.getElementById('sortby').value = items.sortby;
    }
  );
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);