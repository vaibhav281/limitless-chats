export const getUserColor = (userId) => {
    if (!userId) return "#00a884"; // Default fallback (WhatsApp Green)

    // Pre-selected colors guaranteed to look good on dark mode backgrounds
    const colors = [
        "#34b7f1", // Light Blue
        "#ff7a59", // Coral
        "#00e676", // Bright Green
        "#e040fb", // Purple
        "#ffeb3b", // Yellow
        "#ff4081", // Pink
        "#00bcd4", // Cyan
        "#ff9800", // Orange
        "#8bc34a", // Light Green
        "#cddc39", // Lime
        "#f44336", // Red
        "#9c27b0", // Deep Purple
        "#3f51b5", // Indigo
        "#009688", // Teal
        "#795548", // Brown
        "#ff5722", // Deep Orange
    ];

    // Simple string hash function
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Map hash to index (handle negative hashes)
    const index = Math.abs(hash) % colors.length;

    return colors[index];
};
