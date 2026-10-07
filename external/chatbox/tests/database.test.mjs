import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db;
const root = "00000000-0000-4000-8000-000000000001",
  alice = "00000000-0000-4000-8000-000000000002",
  bob = "00000000-0000-4000-8000-000000000003",
  mod = "00000000-0000-4000-8000-000000000004";
async function call(user, action, payload = {}) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ session_id: user }),
  ]);
  await db.query("select public.chat_verify_session($1,$1)", [user]);
  if (
    [
      "moderate",
      "role",
      "nickname",
      "automod",
      "delete_rule",
      "permission",
      "bot_scopes",
      "delete_message",
    ].includes(action)
  )
    return (
      await db.query(
        "select public.chat_verified_action($1,$2,$3::jsonb) result",
        [user, action, JSON.stringify(payload)],
      )
    ).rows[0].result;
  return (
    await db.query("select public.chat_action($1,$2::jsonb) result", [
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
create table public.profiles(id uuid,username text,display_name text,role text,avatar_url text);
create table public.channels(id text,name text,created_by uuid,is_private boolean,is_locked boolean,sort_order bigint);
create table public.messages(id uuid,room text,user_id uuid,text text,image_url text,created_at timestamptz,deleted boolean);
grant select,insert,update on public.messages to authenticated;
create table public.announcements(id uuid,title text,body text,created_by uuid,created_at timestamptz,is_pinned boolean,pinned_at timestamptz);
insert into public.announcements values('22222222-2222-4222-8222-222222222222','Existing announcement','Keep this separate','${root}','2026-01-01',true,'2026-01-02');
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table storage.objects(id text primary key,bucket_id text,name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:cardinality(string_to_array(name,'/'))-1]$$;
grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;alter table storage.objects enable row level security;
insert into auth.users(id,email) values('${root}','root@local.chat'),('${alice}','alice@example.test'),('${bob}','bob@example.test'),('${mod}','mod@example.test');
insert into public.profiles values('${root}','root','Root','admin',null),('${alice}','alice','Alice','user',null),('${bob}','bob','Bob','user',null),('${mod}','mod','Mod','user',null);
insert into public.channels values('lobby','lobby','${root}',false,false,0);
insert into public.messages values('11111111-1111-4111-8111-111111111111','lobby','${alice}','Legacy hello',null,now(),false);`);
  await db.exec(
    await readFile(
      new URL(
        "../../../supabase/migrations/202609280001_chatbox_v2.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../../supabase/migrations/202609280002_chatbox_private_media.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../../supabase/migrations/202610010003_threads_polls.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../../../supabase/migrations/202610010004_automod_actions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const name of [
    "202610010005_bot_sdk_embeds.sql",
    "202610020006_keywords_categories_nicknames.sql",
    "202610020007_hosted_bots.sql",
    "202610040009_bot_interactions.sql",
    "202610070010_verification.sql",
    "202610070011_root_accounts.sql",
  ]) {
    await db.exec(
      await readFile(
        new URL("../../../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  }
});
after(async () => {
  await db?.close();
});

async function botCall(token, action, payload = {}) {
  return (
    await db.query("select public.chat_bot($1,$2,$3::jsonb) result", [
      action,
      token,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
}

test("legacy messages and channels retained without seeded defaults; root identity is immutable", async () => {
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','public.messages','INSERT') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from chat_private.legacy_acl where table_name='messages' and grantee='authenticated'",
      )
    ).rows[0].n,
    3,
  );
  const boot = await call(root, "bootstrap");
  assert.equal(boot.root, true);
  assert.equal(
    (await db.query("select count(*)::int n from public.cb_messages")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.messages")).rows[0].n,
    1,
  );
  assert.deepEqual(
    (
      await db.query(
        "select id,name,sort_order from public.cb_channels order by id",
      )
    ).rows,
    (
      await db.query(
        "select id,name,sort_order from public.channels order by id",
      )
    ).rows,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.cb_categories")).rows[0]
      .n,
    0,
  );
  await assert.rejects(
    call(alice, "profile", { username: "root", display_name: "Fake root" }),
    /reserved/,
  );
});
test("only root assigns and removes Owner, admins cannot escalate", async () => {
  await assert.rejects(
    call(alice, "role", { user_id: alice, role: "Owner", remove: false }),
    /Only root/,
  );
  await call(root, "role", { user_id: alice, role: "Owner", remove: false });
  await assert.rejects(
    call(alice, "role", { user_id: bob, role: "Administrator", remove: false }),
    /Only root/,
  );
  await call(root, "role", { user_id: alice, role: "Owner", remove: true });
  assert.deepEqual(
    (
      await db.query("select roles from public.cb_profiles where id=$1", [
        alice,
      ])
    ).rows[0].roles,
    [],
  );
});
test("private channels enforce view, send, and explicit member overrides", async () => {
  const ch = await call(root, "channel", { name: "private", is_private: true });
  await assert.rejects(
    call(alice, "send", { channel_id: ch.id, text: "invisible" }),
    /cannot send/,
  );
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "view",
    value: true,
  });
  await call(alice, "send", { channel_id: ch.id, text: "allowed" });
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "send",
    value: false,
  });
  await assert.rejects(
    call(alice, "send", { channel_id: ch.id, text: "denied" }),
    /cannot send/,
  );
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "send",
    value: null,
  });
  await call(alice, "send", { channel_id: ch.id, text: "inherited" });
});
test("DMs stay participant-only even for root and are idempotent", async () => {
  const dm = await call(alice, "dm", { user_id: bob });
  assert.equal((await call(bob, "dm", { user_id: alice })).id, dm.id);
  await call(alice, "send", { channel_id: dm.id, text: "private dm" });
  assert.equal(
    (await db.query("select public.cb_can($1,$2,'view') ok", [root, dm.id]))
      .rows[0].ok,
    false,
  );
  await assert.rejects(
    call(root, "send", { channel_id: dm.id, text: "intrusion" }),
    /cannot send/,
  );
});
test("AutoMod blocks words and regex on send AND edit, permits allowed phrases", async () => {
  await call(root, "automod", {
    id: "rule-1",
    name: "test",
    words: ["bad"],
    patterns: ["s[p]+am"],
    allowed_words: ["badminton"],
    block_message: "Custom stop",
  });
  assert.equal(
    (await call(alice, "send", { channel_id: "lobby", text: "BAD words" }))
      .message,
    "Custom stop",
  );
  assert.equal(
    (await call(alice, "send", { channel_id: "lobby", text: "sppam" })).blocked,
    true,
  );
  const msg = await call(alice, "send", {
    channel_id: "lobby",
    text: "badminton",
  });
  assert.ok(msg.id);
  assert.equal(
    (await call(alice, "edit", { id: msg.id, text: "bad" })).blocked,
    true,
  );
  await assert.rejects(
    call(root, "automod", { name: "broken", patterns: ["["] }),
    /regular expression/,
  );
});
test("cross-channel replies, other people’s edits, and mass mentions are rejected", async () => {
  const msg = await call(alice, "send", { channel_id: "lobby", text: "hello" });
  await assert.rejects(
    call(bob, "edit", { id: msg.id, text: "owned" }),
    /own messages/,
  );
  await assert.rejects(
    call(alice, "send", { channel_id: "lobby", text: "@everyone hello" }),
    /mention everyone/,
  );
  const dm = await call(alice, "dm", { user_id: bob });
  await assert.rejects(
    call(alice, "send", { channel_id: dm.id, text: "reply", reply_to: msg.id }),
    /Reply target/,
  );
});
test("warnings require acknowledgement, bans revoke access, lower roles cannot moderate upward", async () => {
  await call(root, "role", { user_id: mod, role: "Moderator", remove: false });
  await assert.rejects(
    call(mod, "moderate", { user_id: root, action: "ban", reason: "no" }),
    /cannot moderate/,
  );
  await call(mod, "moderate", {
    user_id: bob,
    action: "warning",
    reason: "Test warning",
  });
  await assert.rejects(
    call(bob, "send", { channel_id: "lobby", text: "still blocked" }),
    /moderation notice/,
  );
  const warning = (
    await db.query(
      "select id from public.cb_moderation where user_id=$1 and action='warning'",
      [bob],
    )
  ).rows[0];
  await call(bob, "acknowledge", { id: warning.id });
  await call(bob, "send", { channel_id: "lobby", text: "acknowledged" });
  await call(mod, "moderate", {
    user_id: bob,
    action: "ban",
    reason: "Test ban",
  });
  await assert.rejects(
    call(bob, "dm", { user_id: alice }),
    /moderation notice/,
  );
  await call(mod, "moderate", {
    user_id: bob,
    action: "unban",
    reason: "Restored",
  });
});
test("bots use hashed, revocable tokens and cannot gain staff roles", async () => {
  const bot = await call(root, "create_bot", { name: "Test app" });
  assert.ok(bot.token.startsWith("cb_"));
  const row = (
    await db.query("select token_hash from public.cb_bots where id=$1", [
      bot.id,
    ])
  ).rows[0];
  assert.notEqual(row.token_hash, bot.token);
  const sent = await db.query(
    "select public.chat_bot($1,$2,$3::jsonb) result",
    [
      "send",
      bot.token,
      JSON.stringify({ channel_id: "lobby", text: "Hello from bot" }),
    ],
  );
  assert.ok(sent.rows[0].result.id);
  await assert.rejects(
    call(root, "role", { user_id: bot.id, role: "Owner", remove: false }),
    /Bots cannot/,
  );
  await call(root, "revoke_bot", { id: bot.id });
  await assert.rejects(
    db.query("select public.chat_bot('me',$1,'{}')", [bot.token]),
    /Invalid bot token/,
  );
});
test("authenticated users cannot write directly, read private DMs, or read token hashes", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [root]);
  await db.exec("set role authenticated");
  try {
    await assert.rejects(
      db.exec("update public.cb_profiles set roles=array['Owner']"),
      /permission denied/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.cb_messages where room like 'dm-%'",
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(
      db.exec("select token_hash from public.cb_bots"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select chat_private.dispatch($1,'role','{}')", [root]),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("slowmode is per member and channel, survives deletion, allows edits and manager bypass", async () => {
  const ch = await call(root, "channel", {
    name: "Slow conversation",
    slowmode_seconds: 30,
  });
  const blocked = await call(alice, "send", { channel_id: ch.id, text: "bad" });
  assert.equal(blocked.blocked, true);
  const first = await call(alice, "send", {
    channel_id: ch.id,
    text: "First allowed message",
  });
  assert.ok(first.id, "AutoMod rejection must not start cooldown");
  const fast = await call(alice, "send", {
    channel_id: ch.id,
    text: "Too soon",
  });
  assert.equal(fast.slowmode, true);
  assert.ok(fast.retry_after > 0 && fast.retry_after <= 30);
  assert.ok(
    (
      await call(bob, "send", {
        channel_id: ch.id,
        text: "Independent cooldown",
      })
    ).id,
  );
  assert.ok(
    (
      await call(alice, "edit", {
        id: first.id,
        text: "Edited during cooldown",
      })
    ).id,
  );
  await call(alice, "delete_message", { id: first.id });
  assert.equal(
    (
      await call(alice, "send", {
        channel_id: ch.id,
        text: "Deletion cannot bypass",
      })
    ).slowmode,
    true,
  );
  assert.equal(
    (await call(alice, "channel_status", { channel_id: ch.id })).bypass,
    false,
  );
  assert.equal(
    (await call(root, "channel_status", { channel_id: ch.id })).bypass,
    true,
  );
  assert.ok(
    (await call(root, "send", { channel_id: ch.id, text: "Manager one" })).id,
  );
  assert.ok(
    (await call(root, "send", { channel_id: ch.id, text: "Manager two" })).id,
  );
  await db.query(
    "update chat_private.slowmode set last_sent=clock_timestamp()-interval '31 seconds' where actor=$1 and channel_id=$2",
    [alice, ch.id],
  );
  assert.ok(
    (await call(alice, "send", { channel_id: ch.id, text: "Cooldown expired" }))
      .id,
  );
  await call(root, "channel", {
    channel_id: ch.id,
    name: "Slow conversation",
    slowmode_seconds: 0,
  });
  assert.ok(
    (
      await call(alice, "send", {
        channel_id: ch.id,
        text: "Slowmode switched off",
      })
    ).id,
  );
  await assert.rejects(
    call(root, "channel", { name: "Invalid slowmode", slowmode_seconds: -1 }),
    /Slowmode/,
  );
});

test("announcements keep original pins and dates without becoming a default channel", async () => {
  const original = (await db.query("select * from public.announcements"))
      .rows[0],
    copy = (await db.query("select * from public.cb_announcements")).rows[0];
  assert.deepEqual(copy, original);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.cb_channels where id='announcements'",
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    call(alice, "announcement", { title: "Not allowed", body: "test" }),
    /Administrator/,
  );
  await call(root, "announcement", {
    id: copy.id,
    title: copy.title,
    body: "Updated",
    is_pinned: false,
  });
  assert.equal(
    (
      await db.query(
        "select is_pinned from public.cb_announcements where id=$1",
        [copy.id],
      )
    ).rows[0].is_pinned,
    false,
  );
});
test("private attachment access follows channel permissions, including with a broad unrelated storage policy", async () => {
  const ch = await call(root, "channel", {
    name: "Media private",
    is_private: true,
  });
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "view",
    value: true,
  });
  const path = alice + "/" + ch.id + "/clip.mp3";
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice,
  ]);
  await db.exec("set role authenticated");
  try {
    await db.query(
      "insert into storage.objects values('clip','chatbox-private',$1)",
      [path],
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects values('spoof','chatbox-private',$1)",
        [bob + "/" + ch.id + "/clip.mp3"],
      ),
      /row-level security/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
      1,
    );
  } finally {
    await db.exec("reset role");
  }
  await db.exec(
    "create policy unrelated_broad_read on storage.objects for select to authenticated using(true)",
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [bob]);
  await db.exec("set role authenticated");
  try {
    assert.equal(
      (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
      0,
    );
    await assert.rejects(
      db.exec("select * from chat_private.root_account"),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
  await assert.rejects(
    call(bob, "send", {
      channel_id: "lobby",
      text: "File",
      image_url: "cb-media:" + path,
    }),
    /another user or channel/,
  );
  await call(root, "permission", {
    channel_id: ch.id,
    subject: "user:" + alice,
    permission: "view",
    value: false,
  });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice,
  ]);
  await db.exec("set role authenticated");
  try {
    assert.equal(
      (await db.query("select count(*)::int n from storage.objects")).rows[0].n,
      0,
    );
  } finally {
    await db.exec("reset role");
  }
});

async function social(user, action, payload = {}) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  return (
    await db.query("select public.chat_social($1,$2::jsonb) result", [
      action,
      JSON.stringify(payload),
    ])
  ).rows[0].result;
}

test("threads inherit private parent permissions and remain readable when closed", async () => {
  const parent = await call(root, "channel", {
    name: "Thread permissions",
    is_private: true,
  });
  await assert.rejects(
    social(alice, "create_thread", {
      channel_id: parent.id,
      name: "No access",
    }),
    /cannot create/,
  );
  await call(root, "permission", {
    channel_id: parent.id,
    subject: "user:" + alice,
    permission: "view",
    value: true,
  });
  const thread = await social(alice, "create_thread", {
    channel_id: parent.id,
    name: "Project discussion",
  });
  assert.ok(thread.id);
  await call(alice, "send", {
    channel_id: thread.id,
    text: "First thread message",
  });
  await assert.rejects(
    call(bob, "send", { channel_id: thread.id, text: "Denied" }),
    /cannot send/,
  );
  await assert.rejects(
    social(alice, "create_thread", { channel_id: thread.id, name: "Nested" }),
    /cannot create/,
  );
  const list = await social(alice, "threads", { channel_id: parent.id });
  assert.equal(list[0].message_count, 1);
  await social(alice, "archive_thread", { id: thread.id, archived: true });
  await assert.rejects(
    call(alice, "send", { channel_id: thread.id, text: "Closed" }),
    /cannot send/,
  );
  assert.equal(
    (await social(alice, "threads", { channel_id: parent.id }))[0].archived,
    true,
  );
  await social(alice, "archive_thread", { id: thread.id, archived: false });
  await call(root, "permission", {
    channel_id: parent.id,
    subject: "user:" + alice,
    permission: "view",
    value: false,
  });
  assert.equal(
    (
      await db.query("select public.cb_can($1,$2,'view') allowed", [
        alice,
        thread.id,
      ])
    ).rows[0].allowed,
    false,
  );
});

test("polls validate choices, replace votes atomically, remove votes and enforce deadlines", async () => {
  const channel = await call(root, "channel", { name: "Poll tests" });
  const created = await social(root, "create_poll", {
    channel_id: channel.id,
    question: "Pick one",
    answers: [{ text: "Alpha", emoji: "✨" }, { text: "Beta" }],
    duration_hours: 24,
  });
  const data = () =>
    social(alice, "poll_data", { channel_id: channel.id, ids: [created.id] });
  let p = (await data())[0],
    ids = p.options.map((o) => o.id);
  await assert.rejects(
    social(alice, "vote", { id: p.id, choices: ids }),
    /Invalid answer/,
  );
  await assert.rejects(
    social(alice, "vote", { id: p.id, choices: ["invented"] }),
    /Invalid answer/,
  );
  await social(alice, "vote", { id: p.id, choices: [ids[0]] });
  await social(alice, "vote", { id: p.id, choices: [ids[1]] });
  p = (await data())[0];
  assert.equal(p.total, 1);
  assert.equal(p.options[0].votes, 0);
  assert.equal(p.options[1].votes, 1);
  await social(alice, "vote", { id: p.id, choices: [] });
  assert.equal((await data())[0].total, 0);
  await social(root, "close_poll", { id: p.id });
  await assert.rejects(
    social(alice, "vote", { id: p.id, choices: [ids[0]] }),
    /ended/,
  );
  assert.equal((await data())[0].ended, true);
  const multi = await social(root, "create_poll", {
    channel_id: channel.id,
    question: "Pick several",
    answers: [{ text: "One" }, { text: "Two" }],
    multiple: true,
    duration_hours: 1,
  });
  const m = (
    await social(alice, "poll_data", {
      channel_id: channel.id,
      ids: [multi.id],
    })
  )[0];
  await social(alice, "vote", {
    id: m.id,
    choices: m.options.map((o) => o.id),
  });
  const voted = (
    await social(alice, "poll_data", {
      channel_id: channel.id,
      ids: [multi.id],
    })
  )[0];
  assert.equal(voted.total, 1);
  assert.deepEqual(
    voted.options.map((o) => o.votes),
    [1, 1],
  );
});

test("polls and thread titles cannot bypass AutoMod or slowmode", async () => {
  const ch = await call(root, "channel", {
    name: "Social limits",
    slowmode_seconds: 30,
  });
  await call(root, "automod", {
    name: "Social rule",
    words: ["socialblocked"],
    patterns: [],
    allowed_words: [],
  });
  assert.equal(
    (
      await social(root, "create_poll", {
        channel_id: ch.id,
        question: "Good question",
        answers: [{ text: "socialblocked" }, { text: "Okay" }],
      })
    ).blocked,
    true,
  );
  assert.equal(
    (
      await social(root, "create_thread", {
        channel_id: ch.id,
        name: "socialblocked",
      })
    ).blocked,
    true,
  );
  const first = await social(bob, "create_poll", {
    channel_id: ch.id,
    question: "First",
    answers: [{ text: "One" }, { text: "Two" }],
  });
  assert.ok(first.id);
  assert.equal(
    (
      await social(bob, "create_thread", {
        channel_id: ch.id,
        name: "Too soon",
      })
    ).slowmode,
    true,
  );
  await assert.rejects(
    social(root, "create_poll", {
      channel_id: ch.id,
      question: "Invalid",
      answers: [{ text: "Only" }],
    }),
    /2–10/,
  );
});

test("private poll contents and other members' ballots are protected by RLS", async () => {
  const ch = await call(root, "channel", {
    name: "Private poll",
    is_private: true,
  });
  const p = await social(root, "create_poll", {
    channel_id: ch.id,
    question: "Private",
    answers: [{ text: "Yes" }, { text: "No" }],
  });
  await assert.rejects(
    social(alice, "poll_data", { channel_id: ch.id, ids: [p.id] }),
    /unavailable/,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice,
  ]);
  await db.exec("set role authenticated");
  try {
    assert.equal(
      (await db.query("select * from public.cb_polls where id=$1", [p.id])).rows
        .length,
      0,
    );
    assert.equal(
      (
        await db.query("select * from public.cb_poll_votes where user_id<>$1", [
          alice,
        ])
      ).rows.length,
      0,
    );
    await assert.rejects(
      db.query("insert into public.cb_poll_votes values($1,$2,'{}')", [
        p.id,
        alice,
      ]),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("AutoMod applies warnings, mute, and bans atomically, logs privately, and protects root", async () => {
  const log = await call(root, "channel", {
    name: "mod-log",
    is_private: true,
  });
  await assert.rejects(
    call(alice, "automod", { name: "bad grant", actions: ["ban"] }),
    /Administrator/,
  );
  await assert.rejects(
    call(root, "automod", { name: "public log", log_channel_id: "lobby" }),
    /private log/,
  );
  await assert.rejects(
    call(root, "automod", { name: "duration", timeout_seconds: 0 }),
    /duration/,
  );
  await call(root, "automod", {
    id: "action-rule",
    name: "Action rule",
    words: ["actionblocked"],
    actions: ["warning", "timeout"],
    timeout_seconds: 120,
    log_channel_id: log.id,
  });
  const result = await call(alice, "send", {
    channel_id: "lobby",
    text: "actionblocked evidence",
  });
  assert.equal(result.blocked, true);
  assert.deepEqual([...result.actions].sort(), ["timeout", "warning"]);
  const history = (
    await db.query(
      "select * from public.cb_moderation where user_id=$1 and reason='AutoMod: Action rule'",
      [alice],
    )
  ).rows;
  assert.equal(history.length, 2);
  assert.equal(history[0].evidence, "actionblocked evidence");
  await assert.rejects(
    call(alice, "send", { channel_id: "lobby", text: "bypass" }),
    /moderation notice/,
  );
  await call(alice, "acknowledge", {
    id: history.find((x) => x.action === "warning").id,
  });
  await assert.rejects(
    call(alice, "send", { channel_id: "lobby", text: "bypass" }),
    /cannot send/,
  );
  await assert.rejects(
    social(alice, "create_poll", {
      channel_id: "lobby",
      question: "bypass",
      answers: [{ text: "a" }, { text: "b" }],
      duration_hours: 1,
    }),
    /cannot send/,
  );
  const alert = (
    await db.query("select * from public.cb_messages where room=$1", [log.id])
  ).rows[0];
  assert.equal(alert.automod_event.matched, "actionblocked");
  assert.equal(
    (
      await db.query("select public.cb_can($1,$2,'view') allowed", [
        bob,
        log.id,
      ])
    ).rows[0].allowed,
    false,
  );
  await assert.rejects(
    call(alice, "edit", { id: alert.id, text: "forged" }),
    /cannot be edited/,
  );
  await call(root, "moderate", {
    user_id: alice,
    action: "untimeout",
    reason: "test completed",
  });
  await call(root, "automod", {
    id: "action-rule",
    name: "Action rule",
    words: ["actionblocked"],
    actions: ["ban"],
    ban_seconds: 60,
    log_channel_id: log.id,
  });
  assert.deepEqual(
    (await call(root, "send", { channel_id: "lobby", text: "actionblocked" }))
      .actions,
    [],
  );
  assert.deepEqual(
    (await call(bob, "send", { channel_id: "lobby", text: "actionblocked" }))
      .actions,
    ["ban"],
  );
  await assert.rejects(
    call(bob, "send", { channel_id: "lobby", text: "bypass" }),
    /moderation notice/,
  );
  await call(root, "moderate", {
    user_id: bob,
    action: "unban",
    reason: "test completed",
  });
  await call(root, "delete_rule", { id: "action-rule" });
});

test("plain AutoMod phrases split at commas, wildcard boundaries and regex commas are preserved", async () => {
  await call(root, "automod", {
    id: "wildcards",
    name: "Wildcards",
    words: ["cat, dog*\n*bird, *fox*, c++"],
    allowed_words: ["cat nap, dogwood"],
    patterns: ["a{2,3}z"],
  });
  const rule = (
    await db.query("select * from public.cb_automod where id='wildcards'")
  ).rows[0];
  assert.deepEqual(
    [...rule.words].sort(),
    ["*bird", "*fox*", "c++", "cat", "dog*"].sort(),
  );
  assert.deepEqual(rule.patterns, ["a{2,3}z"]);
  for (const [keyword, yes, no] of [
    ["cat", "a cat!", "scatter"],
    ["dog*", "doghouse", "underdog"],
    ["*bird", "blackbird", "birdhouse"],
    ["*fox*", "redfoxes", "fo x"],
    ["c++", "use c++", "ccc"],
    ["h*t", "heat", "has tea"],
  ]) {
    const rows = (
      await db.query(
        "select $2 ~* chat_private.keyword_pattern($1) yes,$3 ~* chat_private.keyword_pattern($1) no",
        [keyword, yes, no],
      )
    ).rows[0];
    assert.equal(rows.yes, true, keyword);
    assert.equal(rows.no, false, keyword);
  }
  assert.equal(
    (await call(root, "send", { channel_id: "lobby", text: "cat" })).blocked,
    true,
  );
  assert.ok(
    (
      await call(root, "send", {
        channel_id: "lobby",
        text: "cat nap and dogwood",
      })
    ).id,
  );
  assert.equal(
    (await call(root, "send", { channel_id: "lobby", text: "aaz" })).blocked,
    true,
  );
  await call(root, "delete_rule", { id: "wildcards" });
});

test("category deletion keeps channels/messages; nicknames require moderator hierarchy and preserve account names", async () => {
  await call(root, "category", { id: "remove-me", name: "Empty category" });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.cb_categories where id='remove-me' and deleted_at is null",
      )
    ).rows[0].n,
    1,
  );
  const channel = await call(root, "channel", {
    name: "Keep this channel",
    category_id: "remove-me",
  });
  const message = await call(root, "send", {
    channel_id: channel.id,
    text: "Keep this message",
  });
  await assert.rejects(
    call(mod, "delete_category", { id: "remove-me" }),
    /Administrator/,
  );
  await call(root, "delete_category", { id: "remove-me" });
  const saved = (
    await db.query("select * from public.cb_channels where id=$1", [channel.id])
  ).rows[0];
  assert.equal(saved.category_id, null);
  assert.equal(saved.archived, false);
  assert.equal(
    (
      await db.query("select text from public.cb_messages where id=$1", [
        message.id,
      ])
    ).rows[0].text,
    "Keep this message",
  );
  await assert.rejects(
    call(alice, "nickname", { user_id: bob, nickname: "Nope" }),
    /cannot change/,
  );
  await assert.rejects(
    call(mod, "nickname", { user_id: root, nickname: "Nope" }),
    /cannot change/,
  );
  await call(mod, "nickname", { user_id: bob, nickname: "Community Bob" });
  let p = (
    await db.query("select * from public.cb_profiles where id=$1", [bob])
  ).rows[0];
  assert.equal(p.nickname, "Community Bob");
  assert.equal(p.username, "bob");
  assert.equal(p.display_name, "Bob");
  await call(mod, "nickname", { user_id: bob, nickname: "" });
  assert.equal(
    (
      await db.query("select nickname from public.cb_profiles where id=$1", [
        bob,
      ])
    ).rows[0].nickname,
    null,
  );
});

test("bot embeds pass AutoMod, edit safely, clear on delete and DMs/events stay private", async () => {
  const bot = await call(root, "create_bot", { name: "SDK test" });
  const dm = await botCall(bot.token, "dm", { user_id: alice });
  assert.equal((await botCall(bot.token, "dm", { user_id: alice })).id, dm.id);
  assert.equal(
    (await db.query("select public.cb_can($1,$2,'view') ok", [root, dm.id]))
      .rows[0].ok,
    false,
  );
  const embeds = [
    {
      title: "Hello",
      description: "**Embed**",
      color: 5793266,
      fields: [{ name: "Status", value: "Ready", inline: true }],
      image: { url: "https://example.com/image.png" },
    },
  ];
  const sent = await botCall(bot.token, "send", { channel_id: dm.id, embeds });
  assert.equal(sent.text, "");
  assert.deepEqual(sent.embeds, embeds);
  const edit = await botCall(bot.token, "edit", {
    id: sent.id,
    text: "New content",
  });
  assert.deepEqual(edit.embeds, embeds);
  await assert.rejects(
    botCall(bot.token, "send", {
      channel_id: dm.id,
      embeds: [{ url: "javascript:alert(1)" }],
    }),
    /HTTPS/,
  );
  await assert.rejects(
    botCall(bot.token, "send", {
      channel_id: dm.id,
      embeds: [{ fields: [{ name: "", value: "x" }] }],
    }),
    /field/,
  );
  await call(root, "automod", {
    id: "embed-rule",
    name: "Embed filtering",
    words: ["embeddanger"],
  });
  assert.equal(
    (
      await botCall(bot.token, "send", {
        channel_id: "lobby",
        embeds: [{ fields: [{ name: "Check", value: "embeddanger" }] }],
      })
    ).blocked,
    true,
  );
  await call(root, "delete_rule", { id: "embed-rule" });
  const events = await botCall(bot.token, "events", {
    after: "1970-01-01",
    after_id: "",
  });
  assert.ok(events.some((m) => m.id === sent.id && m.author.is_bot));
  assert.ok(!events.some((m) => m.text === "private dm"));
  await botCall(bot.token, "delete_message", { id: sent.id });
  assert.deepEqual(
    (
      await db.query("select embeds from public.cb_messages where id=$1", [
        sent.id,
      ])
    ).rows[0].embeds,
    [],
  );
  await call(root, "revoke_bot", { id: bot.id });
  await assert.rejects(botCall(bot.token, "events"), /Invalid bot token/);
});

test("bot moderation and rule management need root-granted scopes and never target staff", async () => {
  const bot = await call(root, "create_bot", { name: "Moderation SDK test" });
  const p = {
    user_id: alice,
    action: "timeout",
    reason: "Test",
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  await assert.rejects(
    botCall(bot.token, "moderate", p),
    /permission required/,
  );
  await assert.rejects(
    call(mod, "bot_scopes", { id: bot.id, scopes: ["moderate"] }),
    /Only root/,
  );
  await call(root, "bot_scopes", {
    id: bot.id,
    scopes: ["moderate", "automod", "manage_messages"],
  });
  await assert.rejects(
    botCall(bot.token, "moderate", { ...p, user_id: root }),
    /staff or root/,
  );
  await assert.rejects(
    botCall(bot.token, "moderate", { ...p, user_id: mod }),
    /staff or root/,
  );
  await botCall(bot.token, "moderate", p);
  await assert.rejects(
    call(alice, "send", { channel_id: "lobby", text: "Restricted" }),
    /cannot send/,
  );
  await botCall(bot.token, "moderate", {
    user_id: alice,
    action: "untimeout",
    reason: "Done",
  });
  await botCall(bot.token, "automod", {
    id: "bot-rule",
    name: "Bot rule",
    words: ["first, second"],
  });
  assert.equal(
    (
      await db.query(
        "select cardinality(words) n from public.cb_automod where id='bot-rule'",
      )
    ).rows[0].n,
    2,
  );
  await botCall(bot.token, "delete_rule", { id: "bot-rule" });
  await call(root, "bot_scopes", { id: bot.id, scopes: [] });
  await assert.rejects(
    botCall(bot.token, "moderate", p),
    /permission required/,
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.chat_bot(text,text,jsonb)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
});

test("hosted queue dispatches visible human events once and protects source, leases, and bot permissions", async () => {
  const bot = await call(root, "create_bot", { name: "Hosted test" });
  const hosted = async (user, action, payload) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    return (
      await db.query("select public.chat_hosted($1,$2::jsonb) result", [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  };
  await assert.rejects(
    hosted(alice, "save", { bot_id: bot.id, source: "test", enabled: true }),
    /owner permission/,
  );
  await hosted(root, "save", { bot_id: bot.id, source: "test", enabled: true });
  const draft = await hosted(root, "draft", {
    bot_id: bot.id,
    source: "unpublished draft",
  });
  assert.equal(draft.source, "test");
  assert.equal(draft.draft_source, "unpublished draft");
  assert.equal(draft.enabled, true);
  const message = await call(root, "send", {
    channel_id: "lobby",
    text: "Hosted event",
  });
  await botCall(bot.token, "send", {
    channel_id: "lobby",
    text: "Bot messages must not recurse",
  });
  const secret = (
    await db.query("select secret from chat_private.bot_runner_config")
  ).rows[0].secret;
  await assert.rejects(
    db.query("select public.chat_hosted_claim($1)", ["wrong"]),
    /authorization/,
  );
  const jobs = (
    await db.query("select public.chat_hosted_claim($1) jobs", [secret])
  ).rows[0].jobs;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].event.message.id, message.id);
  assert.equal(jobs[0].source, "test");
  const j = jobs[0];
  const action = async (name, payload) =>
    (
      await db.query(
        "select public.chat_hosted_action($1,$2,$3,$4::jsonb) result",
        [j.id, j.lease, name, JSON.stringify(payload)],
      )
    ).rows[0].result;
  assert.equal(
    (await db.query("select public.chat_hosted_claim($1) jobs", [secret]))
      .rows[0].jobs.length,
    0,
  );
  await assert.rejects(
    action("moderate", {
      user_id: alice,
      action: "warning",
      reason: "No scope",
    }),
    /permission/,
  );
  assert.ok(
    (await action("send", { channel_id: "lobby", text: "Hosted reply" })).id,
  );
  await db.query("select public.chat_hosted_finish($1,$2,$3::jsonb)", [
    j.id,
    j.lease,
    '{"logs":["done"]}',
  ]);
  await assert.rejects(
    action("send", { channel_id: "lobby", text: "Replay" }),
    /expired/,
  );
  const logs = await hosted(root, "logs", { bot_id: bot.id });
  assert.equal(logs[0].status, "done");
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.chat_hosted_action(bigint,uuid,text,jsonb)','execute') ok",
      )
    ).rows[0].ok,
    false,
  );
  const stopped = await hosted(root, "stop", { bot_id: bot.id });
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.source, "test");
});

test("hosted wakeup is idle without jobs, throttles bursts, and marks abandoned runs without replay", async () => {
  await db.exec(`create schema net;create schema cron;create table net.test_requests(id bigint generated always as identity,url text);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;begin insert into net.test_requests(url) values(url) returning id into n;return n;end $$;
 create function cron.schedule(name text,schedule text,command text) returns bigint language sql as $$select 1::bigint$$;`);
  const sql = await readFile(
    new URL(
      "../../../supabase/migrations/202610020008_hosted_bot_wakeup.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(sql.replace(/^create extension.*;\r?\n/gm, ""));
  await db.exec("select chat_private.hosted_maintenance()");
  assert.equal(
    (await db.query("select count(*)::int n from net.test_requests")).rows[0].n,
    0,
  );
  const bot = await call(root, "create_bot", { name: "Wakeup test" });
  await db.query("select public.chat_hosted($1,$2::jsonb)", [
    "save",
    JSON.stringify({ bot_id: bot.id, source: "test", enabled: true }),
  ]);
  await call(root, "send", { channel_id: "lobby", text: "Wake test event" });
  assert.equal(
    (await db.query("select count(*)::int n from net.test_requests")).rows[0].n,
    1,
  );
  await db.exec("select chat_private.wake_bots()");
  assert.equal(
    (await db.query("select count(*)::int n from net.test_requests")).rows[0].n,
    1,
  );
  await db.exec(
    "update chat_private.bot_jobs set status='running',started_at=now()-interval '3 minutes' where status='pending';select chat_private.hosted_maintenance()",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from chat_private.bot_jobs where status='running'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("select count(*)::int n from net.test_requests")).rows[0].n,
    1,
  );
});

test("bot forms bind the actor, validate fields, deliver once, and hide private replies", async () => {
  const bot = await call(root, "create_bot", { name: "Forms test" });
  const token = bot.token;
  const channel = await call(root, "channel", { name: "forms-test" });
  const interact = async (user, action, payload) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    return (
      await db.query("select public.chat_interact($1,$2::jsonb) result", [
        action,
        JSON.stringify(payload),
      ])
    ).rows[0].result;
  };
  await botCall(token, "commands_set", {
    commands: [{ name: "apply", description: "Apply to join" }],
  });
  const ticket = await interact(alice, "command", {
    bot_id: bot.id,
    channel_id: channel.id,
    name: "apply",
  });
  assert.equal((await botCall(token, "interactions"))[0].id, ticket.id);
  assert.deepEqual(await botCall(token, "interactions"), []);
  await assert.rejects(
    interact(bob, "status", { id: ticket.id }),
    /unavailable/,
  );
  await botCall(token, "interaction_reply", {
    id: ticket.id,
    modal: {
      title: "Apply",
      custom_id: "application",
      fields: [
        {
          custom_id: "reason",
          label: "Reason",
          required: true,
          max_length: 10,
        },
      ],
    },
  });
  await assert.rejects(
    interact(bob, "submit", { id: ticket.id, fields: { reason: "hello" } }),
    /expired/,
  );
  await assert.rejects(
    interact(alice, "submit", { id: ticket.id, fields: { reason: "" } }),
    /required/,
  );
  await assert.rejects(
    interact(alice, "submit", {
      id: ticket.id,
      fields: { reason: "too many characters" },
    }),
    /limits/,
  );
  const child = await interact(alice, "submit", {
    id: ticket.id,
    fields: { reason: "hello", undeclared: "discard" },
  });
  await assert.rejects(
    interact(alice, "submit", { id: ticket.id, fields: { reason: "again" } }),
    /already submitted/,
  );
  const event = (await botCall(token, "interactions"))[0];
  assert.deepEqual(event.fields, { reason: "hello" });
  await botCall(token, "interaction_reply", {
    id: child.id,
    text: "Received privately",
    ephemeral: true,
  });
  assert.equal(
    (await interact(alice, "status", { id: child.id })).response.text,
    "Received privately",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.cb_messages where room=$1",
        [channel.id],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    botCall(token, "interaction_reply", { id: child.id, text: "twice" }),
    /already answered/,
  );
  const message = await botCall(token, "send", {
    channel_id: channel.id,
    text: "Click",
    components: [
      {
        components: [{ type: 2, style: 1, label: "Apply", custom_id: "apply" }],
      },
    ],
  });
  const click = await interact(alice, "button", {
    message_id: message.id,
    custom_id: "apply",
  });
  assert.ok(click.id);
  await assert.rejects(
    interact(alice, "button", { message_id: message.id, custom_id: "forged" }),
    /Button unavailable/,
  );
  await botCall(token, "delete_message", { id: message.id });
  await assert.rejects(
    interact(alice, "button", { message_id: message.id, custom_id: "apply" }),
    /Message unavailable/,
  );
  await assert.rejects(
    botCall(token, "channel", { name: "unauthorized" }),
    /permission required/,
  );
  await assert.rejects(
    botCall(token, "role", { user_id: alice, role: "Owner" }),
    /Unsupported|Unknown|not supported/i,
  );
  await call(root, "bot_scopes", {
    id: bot.id,
    scopes: ["manage_channels", "manage_members"],
  });
  const managed = await botCall(token, "channel", {
    name: "bot-managed",
    is_private: true,
  });
  await botCall(token, "channel", {
    channel_id: managed.id,
    slowmode_seconds: 7,
  });
  assert.equal(
    (
      await db.query(
        "select is_private,slowmode_seconds from public.cb_channels where id=$1",
        [managed.id],
      )
    ).rows[0].is_private,
    true,
  );
  await assert.rejects(
    interact(alice, "command", {
      bot_id: bot.id,
      channel_id: managed.id,
      name: "apply",
    }),
    /permission denied/,
  );
  const thread = await botCall(token, "create_thread", {
    channel_id: channel.id,
    name: "Bot thread",
  });
  assert.ok(thread.id);
  const poll = await botCall(token, "create_poll", {
    channel_id: channel.id,
    question: "Bot poll?",
    answers: [{ text: "Yes" }, { text: "No" }],
  });
  assert.ok(poll.id);
  await botCall(token, "close_poll", { id: poll.id });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    alice,
  ]);
  await assert.rejects(
    db.query("select public.chat_hosted('commands_set',$1::jsonb)", [
      JSON.stringify({ bot_id: bot.id, commands: [] }),
    ]),
    /owner permission/,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [root]);
  await db.query("select public.chat_hosted('save',$1::jsonb)", [
    JSON.stringify({ bot_id: bot.id, source: "test", enabled: true }),
  ]);
  const hostedTicket = await interact(alice, "command", {
    bot_id: bot.id,
    channel_id: channel.id,
    name: "apply",
  });
  assert.deepEqual(await botCall(token, "interactions"), []);
  const secret = (
    await db.query("select secret from chat_private.bot_runner_config")
  ).rows[0].secret;
  const jobs = (
    await db.query("select public.chat_hosted_claim($1) jobs", [secret])
  ).rows[0].jobs;
  assert.ok(jobs.some((j) => j.event.interaction?.id === hostedTicket.id));
});

test("CAPTCHA-protected operations reject direct RPC and session gates use the server launch date", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [root]);
  await assert.rejects(
    db.query("select public.chat_action('moderate','{}')"),
    /CAPTCHA_ACTION_REQUIRED/,
  );
  for (const name of [
    "chat_verified_action(uuid,text,jsonb)",
    "chat_verify_session(uuid,uuid)",
    "chat_root_account(uuid,uuid,text,text)",
  ]) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated',$1,'EXECUTE') ok",
          ["public." + name],
        )
      ).rows[0].ok,
      false,
    );
  }
  await db.query("select set_config('request.jwt.claims','{}',false)");
  await db.query(
    "select chat_private.require_human($1,'2026-10-19T15:59:59Z')",
    [root],
  );
  await assert.rejects(
    db.query("select chat_private.require_human($1,'2026-10-19T16:00:00Z')", [
      root,
    ]),
    /VERIFICATION_REQUIRED/,
  );
  await db.query(
    "insert into chat_private.human_sessions values($1,$1,'2026-10-20T01:00:00+08') on conflict on constraint human_sessions_pkey do update set expires_at=excluded.expires_at",
    [root],
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ session_id: root }),
  ]);
  await db.query(
    "select chat_private.require_human($1,'2026-10-20T00:30:00+08')",
    [root],
  );
  await assert.rejects(
    db.query("select chat_private.require_human($1,'2026-10-20T01:00:00+08')", [
      root,
    ]),
    /VERIFICATION_REQUIRED/,
  );
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ session_id: alice }),
  ]);
  await assert.rejects(
    db.query("select chat_private.require_human($1,'2026-10-20T00:30:00+08')", [
      root,
    ]),
    /VERIFICATION_REQUIRED/,
  );
});

test("root wipe checks confirmation, supports retries and preserves other members and shared channels", async () => {
  const victim = "00000000-0000-4000-8000-000000000011";
  await db.query(
    "insert into auth.users(id,email) values($1,'wipe@example.test')",
    [victim],
  );
  await call(victim, "bootstrap");
  await call(victim, "profile", {
    username: "wipe_test",
    display_name: "Wipe test",
  });
  const channel = await call(root, "channel", { name: "wipe-room" });
  const mine = await call(victim, "send", {
    channel_id: channel.id,
    text: "Private data to wipe",
  });
  const theirs = await call(root, "send", {
    channel_id: channel.id,
    text: "Other member stays",
    reply_to: mine.id,
  });
  await call(root, "role", {
    user_id: victim,
    role: "Administrator",
    remove: false,
  });
  const bot = await call(victim, "create_bot", { name: "Owned bot" });
  await botCall(bot.token, "send", {
    channel_id: channel.id,
    text: "Owned bot data",
  });
  await db.query(
    "insert into public.messages(id,room,user_id,text,created_at) values(gen_random_uuid(),'lobby',$1,'Archived original',now())",
    [victim],
  );
  await db.query(
    "insert into storage.objects values('wipe-asset','chat-media',$1)",
    [victim + "/avatar/a.png"],
  );
  const op = async (actor, operation, confirmation = "DELETE wipe_test") =>
    (
      await db.query("select public.chat_root_account($1,$2,$3,$4) result", [
        actor,
        victim,
        operation,
        confirmation,
      ])
    ).rows[0].result;
  await assert.rejects(op(alice, "check"), /Root permission/);
  await assert.rejects(
    db.query("select public.chat_root_account($1,$1,'check','')", [root]),
    /Root accounts/,
  );
  await assert.rejects(
    op(root, "prepare", "wipe_test"),
    /exact deletion confirmation/,
  );
  const job = await op(root, "prepare");
  assert.equal(job.assets[0].name, victim + "/avatar/a.png");
  assert.equal(job.identities.length, 2);
  assert.equal((await op(root, "prepare")).created_at, job.created_at);
  await assert.rejects(call(victim, "bootstrap"), /deletion is in progress/);
  assert.equal(
    (
      await db.query("select public.cb_can($1,$2,'send') ok", [
        victim,
        channel.id,
      ])
    ).rows[0].ok,
    false,
  );
  await assert.rejects(op(root, "purge"), /Uploads remain/);
  await db.query("delete from storage.objects where id='wipe-asset'");
  assert.equal((await op(root, "purge")).purged, true);
  assert.equal((await op(root, "purge")).purged, true);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.cb_messages where id=$1",
        [theirs.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query("select reply_to from public.cb_messages where id=$1", [
        theirs.id,
      ])
    ).rows[0].reply_to,
    null,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.cb_profiles where id=any($1::uuid[])",
        [job.identities],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.messages where user_id=$1",
        [victim],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(op(root, "finish"), /Delete the login account first/);
  await db.query("delete from auth.users where id=$1", [victim]);
  assert.equal((await op(root, "finish")).deleted, true);
});
