import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const borrowerId = searchParams.get('borrowerId');

    if (!token || !borrowerId) {
        return NextResponse.json({ error: 'Missing token or borrowerId.' }, { status: 400 });
    }

    // ✅ Create a redirect response
    const redirectUrl = new URL(`/shop?borrowerId=${borrowerId}`, req.url);
    const response = NextResponse.redirect(redirectUrl);

    // ✅ Set secure, HTTP-only cookie
    response.cookies.set('superAppToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 30, // 30 minutes
    });

    return response;
}
