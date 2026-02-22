const Auth = {
    // Key for storing users array in localStorage
    USERS_KEY: 'family_users',
    // Key for storing the currently logged-in user in localStorage
    SESSION_KEY: 'current_user',

    getUsers: function () {
        const users = localStorage.getItem(this.USERS_KEY);
        return users ? JSON.parse(users) : [];
    },

    saveUsers: function (users) {
        localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
    },

    register: function (username, password) {
        const users = this.getUsers();
        if (users.find(u => u.username === username)) {
            return { success: false, message: 'Username already exists.' };
        }
        users.push({ username, password }); // In a real app, hash the password!
        this.saveUsers(users);
        // Initialize an empty tree for this user
        localStorage.setItem(`family_tree_${username}`, JSON.stringify([]));
        return { success: true, message: 'Registration successful! Please login.' };
    },

    login: function (username, password) {
        const users = this.getUsers();
        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            localStorage.setItem(this.SESSION_KEY, JSON.stringify(user));
            return { success: true };
        }
        return { success: false, message: 'Invalid username or password.' };
    },

    logout: function () {
        localStorage.removeItem(this.SESSION_KEY);
        window.location.href = 'login.html';
    },

    getCurrentUser: function () {
        const user = localStorage.getItem(this.SESSION_KEY);
        return user ? JSON.parse(user) : null;
    },

    checkAuth: function () {
        if (!this.getCurrentUser()) {
            window.location.href = 'login.html';
        }
    }
};
