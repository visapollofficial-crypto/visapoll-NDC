import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp,
  setDoc, startAfter, where, type DocumentData, type QueryDocumentSnapshot, type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import type { UploadedMedia } from "./upload";

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string | null;
  authorRole: "student" | "staff";
  text: string;
  link: string | null;
  media: UploadedMedia[];
  kind: "post" | "announcement";
  pinned: boolean;
  status: "active" | "hidden";
  likeCount: number;
  commentCount: number;
  reportCount: number;
  createdAt: Timestamp;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: Timestamp | null;
}

export type Cursor = QueryDocumentSnapshot<DocumentData> | null;
export const PAGE_SIZE = 10;

const toPost = (d: QueryDocumentSnapshot<DocumentData>): Post => ({ id: d.id, ...(d.data() as Omit<Post, "id">) });

export async function fetchPosts(cursor: Cursor): Promise<{ posts: Post[]; cursor: Cursor; done: boolean }> {
  const base = [where("status", "==", "active"), orderBy("createdAt", "desc"), limit(PAGE_SIZE)];
  const snap = await getDocs(query(collection(db, "posts"), ...(cursor ? [...base, startAfter(cursor)] : base)));
  return { posts: snap.docs.map(toPost), cursor: snap.docs[snap.docs.length - 1] ?? cursor, done: snap.docs.length < PAGE_SIZE };
}

export async function fetchPinned(): Promise<Post[]> {
  const snap = await getDocs(
    query(collection(db, "posts"), where("status", "==", "active"), where("pinned", "==", true), orderBy("createdAt", "desc"), limit(3))
  );
  return snap.docs.map(toPost);
}

export interface NewPost {
  text: string;
  link?: string;
  media: UploadedMedia[];
  kind: "post" | "announcement";
  pinned: boolean;
}
export const createPost = (p: NewPost) => httpsCallable<NewPost, { id: string }>(functions, "createPost")(p);

export const reportPost = (postId: string, reason: string) =>
  httpsCallable(functions, "reportPost")({ postId, reason });

export const deletePost = (postId: string) => deleteDoc(doc(db, "posts", postId));

// ---- reactions ----
export async function hasLiked(postId: string, uid: string): Promise<boolean> {
  return (await getDoc(doc(db, "posts", postId, "reactions", uid))).exists();
}
export async function setLiked(postId: string, uid: string, liked: boolean): Promise<void> {
  const ref = doc(db, "posts", postId, "reactions", uid);
  if (liked) await setDoc(ref, { createdAt: serverTimestamp() });
  else await deleteDoc(ref);
}

// ---- comments ----
export async function fetchComments(postId: string): Promise<Comment[]> {
  const snap = await getDocs(query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"), limit(50)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Comment, "id">) }));
}
export async function addComment(postId: string, uid: string, authorName: string, text: string): Promise<void> {
  await addDoc(collection(db, "posts", postId, "comments"), { authorId: uid, authorName, text, createdAt: serverTimestamp() });
}
export const deleteComment = (postId: string, id: string) => deleteDoc(doc(db, "posts", postId, "comments", id));
