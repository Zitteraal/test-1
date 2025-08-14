// script.js

document.addEventListener('DOMContentLoaded', function () {
    const dropdown = document.querySelector('.dropdown');
    const dropdownContent = document.querySelector('.dropdown-content');

    dropdown.addEventListener('click', function (event) {
        event.preventDefault();
        dropdownContent.classList.toggle('show');
    });

    document.addEventListener('click', function (event) {
        if (!dropdown.contains(event.target)) {
            dropdownContent.classList.remove('show');
        }
    });
});
