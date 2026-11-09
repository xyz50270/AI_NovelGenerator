from fastapi import APIRouter, Request
from backend.services.novel.novel_service import NovelService
from backend.services.novel.chapter_service import ChapterService

router = APIRouter(prefix="/api/reader", tags=["reader"])


def _origin(request: Request) -> str:
    """按本次请求的来源生成绝对地址，使内网与公网反代都能得到可用链接。

    Args:
        request: 当前请求。
    Returns:
        形如 ``https://novel.example.com`` 的来源前缀，不含结尾斜杠。
    """
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}".rstrip("/")


@router.get("/novels")
async def list_reader_novels(request: Request):
    base_url = _origin(request)
    novels = await NovelService.list_novels()
    result = []
    for n in novels:
        nid = str(n.get("id") or n.get("_id"))
        tags = n.get("tags") or []
        tag_str = ",".join(tags) if isinstance(tags, list) else str(tags)
        words = n.get("stats", {}).get("total_word_count", 0) or n.get("current_word_count", 0)
        result.append({
            "name": n.get("title", ""),
            "author": n.get("genre", "AI"),
            "intro": n.get("summary", ""),
            "kind": tag_str,
            "wordCount": words,
            "bookUrl": f"{base_url}/api/reader/novel/{nid}",
            "tocUrl": f"{base_url}/api/reader/toc/{nid}"
        })
    return result


@router.get("/novel/{novel_id}")
async def get_reader_novel(novel_id: str, request: Request):
    base_url = _origin(request)
    novel = await NovelService.get_novel(novel_id)
    tags = novel.get("tags") or []
    tag_str = ",".join(tags) if isinstance(tags, list) else str(tags)
    words = novel.get("stats", {}).get("total_word_count", 0) or novel.get("current_word_count", 0)
    return {
        "name": novel.get("title", ""),
        "author": novel.get("genre", "AI"),
        "intro": novel.get("summary", ""),
        "kind": tag_str,
        "wordCount": words,
        "tocUrl": f"{base_url}/api/reader/toc/{novel_id}"
    }


@router.get("/toc/{novel_id}")
async def get_reader_toc(novel_id: str, request: Request):
    base_url = _origin(request)
    rows = await ChapterService.list_chapters(novel_id, deleted=False)
    result = []
    for c in rows:
        cid = str(c.get("chapter_id") or c.get("_id"))
        num = c.get("chapter_number") or c.get("order_index")
        title = c.get("title", "")
        display_title = f"第{num}章 {title}" if num else title
        result.append({
            "title": display_title,
            "url": f"{base_url}/api/reader/chapter/{cid}",
            "wordCount": c.get("word_count", 0)
        })
    return result


@router.get("/chapter/{chapter_id}")
async def get_reader_chapter(chapter_id: str):
    chapter = await ChapterService.get_chapter(chapter_id)
    return {
        "title": chapter.get("title", ""),
        "content": chapter.get("content", "")
    }
