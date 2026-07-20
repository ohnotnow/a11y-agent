() => {
    const parts = Array.from(document.querySelectorAll("[data-a11y-highlight]"));
    for (const part of parts)
        part.remove();
    return parts.length > 0 ? "unhighlighted" : "nothing highlighted";
}
