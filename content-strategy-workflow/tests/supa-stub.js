window.supabase = { createClient: function () {
  var role = window.__ROLE || 'admin';
  function q(table) {
    var data = table === 'profiles' ? { id: 'u-' + role, role: role, email: role + '@example.com', display_name: 'Test ' + role }
      : table === 'account_access' ? (role === 'admin' ? [] : [{ clickup_account_id: 'A1', clickup_list_id: 'L1' }]) : [];
    var b = { select: function () { return b; }, in: function () { return b; }, eq: function () { return b; }, order: function () { return b; },
      single: function () { return Promise.resolve({ data: data, error: null }); },
      then: function (res, rej) { return Promise.resolve({ data: data, error: null }).then(res, rej); } };
    return b;
  }
  return {
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: (window.__LOGGED_OUT ? null : { user: { id: 'u-' + role, email: role + '@example.com' }, access_token: 'tok' }) } }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
      signOut: function () { return Promise.resolve({}); }
    },
    from: q, storage: { from: function () { return {}; } }
  };
} };
