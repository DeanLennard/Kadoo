"use client";

import { Paperclip, Download } from "lucide-react";
import { useState } from "react";

type Props = {
    threadId: string;
    uid: number;
    items?: { filename: string; size?: number; contentType?: string }[];
};

export default function Attachments({ threadId, uid, items }: Props) {
    if (!items?.length) return null;

    const formatSize = (bytes?: number) => {
        if (!bytes) return "";
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };

    return (
        <div className="mt-3 mb-3 flex flex-wrap gap-3">
            {items.map((a) => {
                const href = `/api/inbox/attachment?threadId=${encodeURIComponent(
                    threadId
                )}&uid=${uid}&filename=${encodeURIComponent(a.filename)}`;

                const ext = a.filename.split(".").pop()?.toUpperCase() || "";
                const isImage =
                    (a.contentType || "").startsWith("image/") ||
                    ["PNG", "JPG", "JPEG", "GIF", "WEBP"].includes(ext);

                return (
                    <AttachmentCard
                        key={a.filename}
                        href={href}
                        filename={a.filename}
                        size={formatSize(a.size)}
                        isImage={isImage}
                    />
                );
            })}
        </div>
    );
}

function AttachmentCard({
                            href,
                            filename,
                            size,
                            isImage,
                        }: {
    href: string;
    filename: string;
    size?: string;
    isImage?: boolean;
}) {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            className="relative w-40 border rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow bg-white group"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Thumbnail area */}
            <div className="h-24 bg-[var(--cloud)] flex items-center justify-center overflow-hidden">
                {isImage ? (
                    // small inline preview
                    <img
                        src={href}
                        alt={filename}
                        className="object-cover w-full h-full"
                    />
                ) : (
                    <Paperclip className="text-gray-400 w-6 h-6" />
                )}
            </div>

            {/* Filename + size */}
            <div className="p-2 text-xs truncate">
                <div className="font-medium truncate">{filename}</div>
                {size && <div className="text-[10px] text-gray-500">{size}</div>}
            </div>

            {/* Hover overlay with Download */}
            <a
                href={href}
                className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity`}
                download
            >
                <Download className="w-5 h-5" />
            </a>
        </div>
    );
}
